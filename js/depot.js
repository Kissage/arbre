"use strict";
/* Accès au dépôt GitHub privé qui contient les données (arbre.json + photos/).
 *
 * Lecture : référence de la branche -> commit -> arborescence -> fichiers (mis en cache par empreinte SHA).
 * Écriture : chaque modification est une « opération » (fonction appliquée aux données) ; elle devient un commit
 * signé par la personne connectée. Si l'autre personne a enregistré entre-temps, on relit ses données, on rejoue
 * l'opération par-dessus, puis on réessaie : les deux séries de modifications sont conservées.
 */
const Depot = (() => {
  const API = new URLSearchParams(location.search).get("api") || localStorage.getItem("arbre.api") || "https://api.github.com";
  const CLE_CONNEXION = "arbre.connexion";
  const FICHIER = "arbre.json";

  let cfg = null;              // { depot: "proprietaire/nom", jeton }
  let utilisateur = null;      // { login, name }
  let branche = "main";
  let base = null;             // { commit, arbre, fichiers: Map(chemin -> sha) } : dernier état connu du dépôt
  let distant = null;          // données (format stocké) au commit « base »
  let courant = null;          // distant + opérations en attente
  const attente = [];          // opérations pas encore enregistrées
  const ecouteurs = { donnees: [], etat: [] };
  let occupe = false, dernierEtat = { type: "ok" };

  class ErreurApi extends Error {
    constructor(statut, message) { super(message); this.statut = statut; }
  }
  /** L'opération n'a plus de sens sur les données actuelles (ex. personne supprimée par l'autre utilisateur). */
  class ErreurOperation extends Error {}
  const emettre = (type, x) => ecouteurs[type].forEach(f => { try { f(x); } catch (e) { console.error(e); } });
  function etat(type, texte = "") { dernierEtat = { type, texte, attente: attente.length }; emettre("etat", dernierEtat); }

  /* ---------------- requêtes ---------------- */
  async function api(chemin, { methode = "GET", corps, accept = "application/vnd.github+json", brut = false } = {}) {
    let r;
    try {
      r = await fetch(API + chemin, {
        method: methode, cache: "no-store",
        headers: { Authorization: `Bearer ${cfg.jeton}`, Accept: accept, ...(corps ? { "Content-Type": "application/json" } : {}) },
        body: corps ? JSON.stringify(corps) : undefined,
      });
    } catch (e) {
      throw new ErreurApi(0, "Connexion impossible (hors ligne ?)");
    }
    if (!r.ok) {
      let msg = r.statusText;
      try { msg = (await r.json()).message || msg; } catch { /* corps vide */ }
      if (r.status === 401) msg = "Jeton refusé (expiré ou révoqué ?)";
      if (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0") msg = "Trop de requêtes : réessayez dans une heure";
      throw new ErreurApi(r.status, msg);
    }
    if (brut) return r;
    return r.status === 204 ? null : r.json();
  }
  const repo = chemin => `/repos/${cfg.depot}${chemin}`;

  /* ---------------- cache des fichiers (par empreinte : un contenu ne change jamais) ---------------- */
  let cache = null;
  async function ouvrirCache() {
    if (cache !== null) return cache;
    try { cache = self.caches ? await caches.open("arbre-fichiers") : false; } catch { cache = false; }
    return cache;
  }
  const cleCache = sha => new Request(`https://cache.arbre.local/${sha}`);
  async function lireBlob(sha) {
    const c = await ouvrirCache();
    if (c) { const r = await c.match(cleCache(sha)); if (r) return r.arrayBuffer(); }
    let octets;
    for (let essai = 0; ; essai++) {        // un téléchargement coupé est retenté (3 essais)
      try {
        const r = await api(repo(`/git/blobs/${sha}`), { accept: "application/vnd.github.raw+json", brut: true });
        try { octets = await r.arrayBuffer(); } catch { throw new ErreurApi(0, "Téléchargement interrompu"); }
        break;
      } catch (e) {
        if (e.statut !== 0 || essai >= 2) throw e;
        await new Promise(res => setTimeout(res, 1000 * (essai + 1)));
      }
    }
    if (c) try { await c.put(cleCache(sha), new Response(octets.slice(0))); } catch { /* quota */ }
    return octets;
  }
  async function memoriser(sha, octets) {
    const c = await ouvrirCache();
    if (c) try { await c.put(cleCache(sha), new Response(octets)); } catch { /* quota */ }
  }

  /* ---------------- connexion ---------------- */
  function configuration() {
    try { return JSON.parse(localStorage.getItem(CLE_CONNEXION)) || null; } catch { return null; }
  }
  async function connecter(depot, jeton, { memoriserConnexion = true, auteur = "" } = {}) {
    cfg = { depot: depot.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, ""), jeton: jeton.trim(),
      auteur: auteur.trim() };
    utilisateur = await api("/user");
    let infos;
    try { infos = await api(repo("")); } catch (e) {
      if (e.statut === 404) throw new ErreurApi(404, `Dépôt « ${cfg.depot} » introuvable, ou ce jeton n’y a pas accès`);
      throw e;
    }
    if (infos.permissions && !infos.permissions.push) throw new ErreurApi(403, "Ce jeton ne permet pas de modifier le dépôt (droit « Contents : read and write » manquant ?)");
    branche = infos.default_branch || "main";
    if (memoriserConnexion) localStorage.setItem(CLE_CONNEXION, JSON.stringify(cfg));
    return utilisateur;
  }
  function deconnecter() {
    localStorage.removeItem(CLE_CONNEXION);
    cfg = null; base = distant = courant = null;
    ouvrirCache().then(c => c && caches.delete("arbre-fichiers"));
  }

  /* ---------------- lecture ---------------- */
  async function lireEtatDistant() {
    let ref;
    try { ref = await api(repo(`/git/ref/heads/${branche}`)); } catch (e) {
      if (e.statut === 409 || e.statut === 404) throw new ErreurApi(409, "Le dépôt est vide : déposez-y d’abord arbre.json et le dossier photos (voir la notice)");
      throw e;
    }
    const commit = await api(repo(`/git/commits/${ref.object.sha}`));
    const arbre = await api(repo(`/git/trees/${commit.tree.sha}?recursive=1`));
    const fichiers = new Map(arbre.tree.filter(x => x.type === "blob").map(x => [x.path, x.sha]));
    return { commit: ref.object.sha, arbre: commit.tree.sha, fichiers, auteur: commit.author };
  }
  async function lireDonnees(etatDistant) {
    const sha = etatDistant.fichiers.get(FICHIER);
    if (!sha) throw new ErreurApi(404, `Le dépôt ne contient pas ${FICHIER} (voir la notice d’installation)`);
    return Modele.lire(new TextDecoder().decode(await lireBlob(sha)));
  }
  async function charger() {
    etat("charge", "Chargement…");
    const e = await lireEtatDistant();
    distant = await lireDonnees(e);
    base = e;
    recalculerCourant();
    etat("ok");
    return courant;
  }
  function recalculerCourant() {
    courant = Modele.cloner(distant);
    for (const op of attente.slice()) {
      try { op.faire(courant); } catch (e) {
        attente.splice(attente.indexOf(op), 1);
        emettre("etat", { type: "erreur", texte: `Modification abandonnée (« ${op.message} ») : ${e.message}` });
      }
    }
    emettre("donnees", courant);
  }

  /* ---------------- écriture ---------------- */
  /** op = { message, faire(donnees), fichiers: [{ chemin, octets: Uint8Array }] } */
  function appliquer(op) {
    op.faire(courant);                  // effet immédiat à l'écran ; l'enregistrement suit en arrière-plan
    attente.push(op);
    emettre("donnees", courant);
    enregistrerAttente();
  }
  const base64 = octets => {
    let s = "";
    for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
    return btoa(s);
  };
  async function commiter(op) {
    for (let essai = 0; essai < 5; essai++) {
      const donnees = Modele.cloner(distant);
      try { op.faire(donnees); } catch (e) { throw new ErreurOperation(e.message); }  // ex. l'autre a supprimé ce qu'on modifie
      const texte = Modele.serialiser(donnees);
      const entrees = [];
      for (const f of op.fichiers || []) {
        const b = await api(repo("/git/blobs"), { methode: "POST", corps: { content: base64(f.octets), encoding: "base64" } });
        f.sha = b.sha;
        entrees.push({ path: f.chemin, mode: "100644", type: "blob", sha: b.sha });
      }
      const blob = await api(repo("/git/blobs"), { methode: "POST", corps: { content: texte, encoding: "utf-8" } });
      entrees.push({ path: FICHIER, mode: "100644", type: "blob", sha: blob.sha });
      const arbre = await api(repo("/git/trees"), { methode: "POST", corps: { base_tree: base.arbre, tree: entrees } });
      // prénom saisi à la connexion : il signe le commit (utile quand deux personnes partagent le même jeton)
      const auteur = cfg.auteur ? { author: { name: cfg.auteur, email: "arbre-familial@users.noreply.github.com" } } : {};
      const commit = await api(repo("/git/commits"), { methode: "POST", corps: { message: op.message, tree: arbre.sha, parents: [base.commit], ...auteur } });
      try {
        await api(repo(`/git/refs/heads/${branche}`), { methode: "PATCH", corps: { sha: commit.sha, force: false } });
      } catch (e) {
        if (e.statut !== 422 && e.statut !== 409) throw e;
        // quelqu'un a enregistré entre-temps : on repart de sa version et on rejoue l'opération.
        // « base » et « distant » ne changent qu'ensemble : sinon on réécrirait l'ancienne version par-dessus la sienne.
        const nouvelle = await lireEtatDistant();
        const donneesNouvelles = await lireDonnees(nouvelle);
        base = nouvelle; distant = donneesNouvelles;
        emettre("etat", { type: "fusion", texte: "Modifications de l’autre utilisateur intégrées" });
        continue;
      }
      await memoriser(blob.sha, new TextEncoder().encode(texte));
      for (const f of op.fichiers || []) await memoriser(f.sha, f.octets.slice().buffer);
      base = { commit: commit.sha, arbre: arbre.sha, fichiers: new Map(base.fichiers) };
      base.fichiers.set(FICHIER, blob.sha);
      for (const f of op.fichiers || []) base.fichiers.set(f.chemin, f.sha);
      distant = donnees;
      return;
    }
    throw new ErreurApi(409, "Trop de modifications simultanées, réessayez");
  }
  let relance = null;
  async function enregistrerAttente() {
    if (occupe) return;
    occupe = true;
    clearTimeout(relance);
    try {
      while (attente.length) {
        etat("enregistre", "Enregistrement…");
        const op = attente[0];
        try {
          await commiter(op);
          attente.shift();
        } catch (e) {
          if (e instanceof ErreurOperation) {   // seule cette erreur fait abandonner la modification
            attente.shift();
            etat("erreur", `Modification abandonnée (« ${op.message} ») : ${e.message}`);
            recalculerCourant();
            return;
          }
          if (e instanceof ErreurApi && (e.statut === 401 || e.statut === 404)) {
            etat("erreur", `Non enregistré : ${e.message}. Notez votre modification, puis reconnectez-vous (menu ☰ → Se déconnecter).`);
            return;                           // la modification reste en attente
          }
          // réseau coupé, GitHub indisponible, limite de requêtes… : on réessaie tout seul
          etat("horsligne", `Non enregistré : ${e.message}. Nouvel essai automatique dans 20 s…`);
          relance = setTimeout(enregistrerAttente, 20000);
          return;
        }
      }
      recalculerCourant();
      etat("ok", "Enregistré");
    } finally {
      occupe = false;
    }
  }
  window.addEventListener("online", () => attente.length && enregistrerAttente());
  window.addEventListener("beforeunload", e => { if (attente.length) { e.preventDefault(); e.returnValue = ""; } });

  /** Si l'autre personne a enregistré depuis le chargement, on récupère sa version. */
  async function verifierDistant() {
    if (!cfg || !base || occupe || attente.length) return false;
    let ref;
    try { ref = await api(repo(`/git/ref/heads/${branche}`)); } catch { return false; }
    if (ref.object.sha === base.commit) return false;
    const depart = base.commit;
    let nouvelle, donnees;
    try { nouvelle = await lireEtatDistant(); donnees = await lireDonnees(nouvelle); } catch { return false; }
    if (occupe || attente.length || base.commit !== depart) return false;   // un enregistrement a pris le relais
    distant = donnees;
    base = nouvelle;
    recalculerCourant();
    const qui = nouvelle.auteur?.name || "quelqu’un";
    etat("fusion", `Arbre mis à jour avec les modifications de ${qui}`);
    return true;
  }

  /* ---------------- photos ---------------- */
  const urls = new Map();       // chemin -> URL blob:
  const locaux = new Map();     // chemin -> octets pas encore enregistrés
  function ajouterLocal(chemin, octets) {
    locaux.set(chemin, octets);
    urls.set(chemin, Promise.resolve(URL.createObjectURL(new Blob([octets], { type: "image/jpeg" }))));
  }
  function urlPhoto(chemin) {
    if (!chemin) return Promise.resolve("");
    if (!urls.has(chemin)) {
      const sha = base?.fichiers.get(chemin);
      const p = sha ? lireBlob(sha).then(o => URL.createObjectURL(new Blob([o], { type: "image/jpeg" }))) : Promise.resolve("");
      urls.set(chemin, p.catch(() => { urls.delete(chemin); return ""; }));
    }
    return urls.get(chemin);
  }
  async function octetsPhoto(chemin) {
    if (locaux.has(chemin)) return locaux.get(chemin);
    const sha = base?.fichiers.get(chemin);
    return sha ? new Uint8Array(await lireBlob(sha)) : null;
  }

  /* ---------------- historique ---------------- */
  function historique(n = 50) {
    return api(repo(`/commits?sha=${encodeURIComponent(branche)}&per_page=${n}`));
  }

  return {
    configuration, connecter, deconnecter, charger, appliquer, verifierDistant, urlPhoto, octetsPhoto, ajouterLocal,
    historique,
    get donnees() { return courant; },
    get utilisateur() { return utilisateur; },
    get depot() { return cfg?.depot; },
    get etat() { return dernierEtat; },
    get enAttente() { return attente.length; },
    lienGitHub: chemin => `https://github.com/${cfg.depot}${chemin || ""}`,
    surDonnees: f => ecouteurs.donnees.push(f),
    surEtat: f => ecouteurs.etat.push(f),
  };
})();
