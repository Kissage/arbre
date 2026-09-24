"use strict";
/* Modification de l'arbre : fenêtres de saisie et opérations.
 *
 * Une opération = { message, faire(donnees), fichiers } : faire() modifie les données au format stocké (arbre.json)
 * en ne s'appuyant que sur des identifiants, pour pouvoir être rejouée par-dessus les modifications de l'autre
 * utilisateur (voir depot.js). Les identifiants nouveaux sont tirés avant, pas dans faire().
 */
const Edition = (() => {
  const dlg = $("#editeur");
  const TYPES_PERSONNE = ["Profession", "Titre", "Baptême", "Inhumation", "Résidence", "Recensement", "Religion",
    "Nationalité", "Formation", "Diplôme", "Émigration", "Immigration", "Testament", "Événement"];
  const TYPES_UNION = ["Divorce", "Contrat de mariage", "Fiançailles", "Bans de mariage", "Annulation", "Événement"];

  /* ---------------- accès aux données stockées ---------------- */
  const B = () => Depot.donnees;
  function pers(d, id) {
    const p = d.personnes.find(x => x.id === id);
    if (!p) throw new Error("cette personne n’existe plus (supprimée entre-temps ?)");
    return p;
  }
  function fam(d, id) {
    const f = d.familles.find(x => x.id === id);
    if (!f) throw new Error("cette famille n’existe plus (modifiée entre-temps ?)");
    return f;
  }
  const nomDe = p => [p.prenoms, p.nom].filter(Boolean).join(" ") || "personne sans nom";
  const nomId = id => { try { return nomDe(pers(B(), id)); } catch { return id; } };
  const copie = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  /** Parmi les familles touchées par l'opération, retire celles qui ne relient plus personne (≤ 1 membre) et ne
      portent aucune information (un mariage avec conjoint inconnu, par exemple, est conservé). */
  const familleVide = f => {
    const n = [f.pere, f.mere].filter(Boolean).length + (f.enfants || []).length;
    return n === 0 || (n === 1 && !f.mariage && !f.evenements?.length && !f.notes?.length && !f.sources?.length);
  };
  function nettoyerFamilles(d, ids) {
    const touchees = new Set(ids);
    d.familles = d.familles.filter(f => !touchees.has(f.id) || !familleVide(f));
  }
  /** Contrôle l'opération sur une copie avant de l'appliquer : une erreur reste dans la fenêtre. */
  function executer(op) {
    op.faire(Modele.cloner(B()));
    Depot.appliquer(op);
  }

  /* ---------------- champs de formulaire ---------------- */
  const attr = v => esc(v ?? "");
  function champ(label, nom, valeur, { large = false, zone = false, lignes = 3, aide = "", type = "text", attrs = "" } = {}) {
    const entree = zone ? `<textarea name="${nom}" rows="${lignes}" ${attrs}>${esc(valeur ?? "")}</textarea>`
      : `<input type="${type}" name="${nom}" value="${attr(valeur)}" ${attrs}>`;
    return `<label class="champ${large ? " large" : ""}">${label}${entree}${aide ? `<span class="aide">${aide}</span>` : ""}</label>`;
  }
  /** Date saisie en français ; l'aide montre comment elle est comprise. data-orig garde la date GEDCOM d'origine. */
  function champDate(label, nom, gedcom, attrsSupp = "") {
    const aff = Modele.dateSaisie(gedcom);
    const attrs = `${nom ? `name="${nom}"` : ""} data-date data-orig="${attr(gedcom)}" data-aff="${attr(aff)}" placeholder="ex. : 24/03/1951, vers 1800" ${attrsSupp}`;
    return `<label class="champ">${label}<input type="text" value="${attr(aff)}" ${attrs}><span class="aide"></span></label>`;
  }
  function lireDate(input) {
    if (input.value === input.dataset.aff) return input.dataset.orig || "";
    const r = Modele.lireDate(input.value);
    if (r.erreur) { input.focus(); throw new Error(`${r.erreur} : « ${input.value} »`); }
    return r.gedcom;
  }
  const radio = (nom, valeur, texte, courant) =>
    `<label><input type="radio" name="${nom}" value="${valeur}" ${valeur === courant ? "checked" : ""}> ${texte}</label>`;
  const options = (liste, courant) => [...new Set([...liste, ...(courant ? [courant] : [])])]
    .map(t => `<option ${t === courant ? "selected" : ""}>${esc(t)}</option>`).join("");

  const LIGNES = {
    evenements: (e = {}, types = TYPES_PERSONNE) => `<div class="item-ed" data-item data-orig="${attr(JSON.stringify(e))}">` +
      `<button type="button" class="suppr" title="Retirer" aria-label="Retirer">×</button><div class="grille">` +
      `<label class="champ">Type<select data-k="type">${options(types, e.type || types[0])}</select></label>` +
      `<label class="champ">Intitulé (métier, titre…)<input data-k="valeur" value="${attr(e.valeur)}"></label>` +
      champDate("Date", "", e.date, 'data-k="date"') +
      `<label class="champ">Lieu<input data-k="lieu" value="${attr(e.lieu)}"></label>` +
      `<label class="champ large">Note<textarea data-k="note" rows="2">${esc(e.note || "")}</textarea></label></div></div>`,
    notes: (t = "") => `<div class="item-ed" data-item><button type="button" class="suppr" title="Retirer" aria-label="Retirer">×</button>` +
      `<label class="champ large">Note<textarea data-k="texte" rows="${Math.min(14, Math.max(4, Math.ceil(t.length / 90)))}">${esc(t)}</textarea></label></div>`,
    sources: (s = {}) => `<div class="item-ed" data-item><button type="button" class="suppr" title="Retirer" aria-label="Retirer">×</button><div class="grille">` +
      `<label class="champ">Titre (registre, site, archive…)<input data-k="titre" value="${attr(s.titre)}"></label>` +
      `<label class="champ">Référence ou lien<input data-k="page" value="${attr(s.page)}"></label>` +
      `<label class="champ large">Extrait<textarea data-k="extrait" rows="2">${esc(s.extrait || "")}</textarea></label></div></div>`,
  };
  function liste(cle, elements, texteAjout, types) {
    return `<div class="liste-ed" data-liste="${cle}">${elements.map(e => LIGNES[cle](e, types)).join("")}</div>` +
      `<button type="button" class="ajout" data-ajout="${cle}" ${types ? `data-types="${attr(JSON.stringify(types))}"` : ""}>${texteAjout}</button>`;
  }
  function lireListe(form, cle) {
    const res = [];
    for (const item of form.querySelectorAll(`[data-liste="${cle}"] > [data-item]`)) {
      if (cle === "notes") { const t = item.querySelector('[data-k="texte"]').value.trim(); if (t) res.push(t); continue; }
      const r = cle === "evenements" ? { ...JSON.parse(item.dataset.orig || "{}") } : {};
      for (const el of item.querySelectorAll("[data-k]")) r[el.dataset.k] = el.dataset.date !== undefined ? lireDate(el) : el.value.trim();
      if (cle === "evenements" && !(r.valeur || r.date || r.lieu || r.note)) continue;
      if (cle === "sources" && !(r.titre || r.page)) continue;
      res.push(r);
    }
    return res;
  }

  /* ---------------- fenêtre ---------------- */
  let modifie = false;
  function ouvrirDialogue({ titre, sousTitre = "", corps, enregistrer = "Enregistrer", supprimer = "", surEnregistrer, surSupprimer, apres }) {
    dlg.innerHTML = `<form novalidate><div class="ed-hd"><h2>${esc(titre)}</h2>${sousTitre ? `<p>${sousTitre}</p>` : ""}</div>` +
      `<div class="ed-corps">${corps}</div><div class="ed-pied">` +
      (supprimer ? `<button type="button" class="btn danger" data-act="supprimer">${supprimer}</button>` : "") +
      `<span class="espace"></span><p class="erreur" hidden></p>` +
      `<button type="button" class="btn" data-act="annuler">Annuler</button>` +
      (enregistrer ? `<button type="submit" class="btn primary">${enregistrer}</button>` : "") + `</div></form>`;
    const form = dlg.querySelector("form"), erreur = form.querySelector(".erreur");
    modifie = false;
    const echec = e => { erreur.textContent = e.message; erreur.hidden = false; };
    form.addEventListener("submit", async e => {
      e.preventDefault();
      erreur.hidden = true;
      const bouton = form.querySelector('[type="submit"]');
      bouton.disabled = true;
      try { if (await surEnregistrer(form) !== false) fermer(true); } catch (err) { echec(err); } finally { bouton.disabled = false; }
    });
    form.addEventListener("click", async e => {
      const t = e.target;
      if (t.closest('[data-act="annuler"]')) return fermer();
      if (t.closest('[data-act="supprimer"]')) {
        try { if (await surSupprimer(form) !== false) fermer(true); } catch (err) { echec(err); }
        return;
      }
      const aj = t.closest("[data-ajout]");
      if (aj) {
        const cle = aj.dataset.ajout, cont = form.querySelector(`[data-liste="${cle}"]`);
        cont.insertAdjacentHTML("beforeend", LIGNES[cle](undefined, aj.dataset.types ? JSON.parse(aj.dataset.types) : undefined));
        cont.lastElementChild.querySelector("input, textarea, select")?.focus();
        modifie = true;
        return;
      }
      const sup = t.closest(".suppr");
      if (sup) { sup.closest("[data-item]").remove(); modifie = true; }
    });
    form.addEventListener("input", e => {
      modifie = true;
      if (e.target.dataset.date !== undefined) aideDate(e.target);
    });
    form.querySelectorAll("[data-date]").forEach(aideDate);
    apres?.(form);
    dlg.showModal();
    form.querySelector(".ed-corps input:not([type=hidden]):not([type=radio]):not([type=checkbox]), .ed-corps textarea")?.focus();
  }
  function aideDate(input) {
    const aide = input.parentElement.querySelector(".aide");
    if (!aide) return;
    if (!input.value.trim() || input.value === input.dataset.aff) { aide.textContent = ""; aide.classList.remove("ko"); return; }
    const r = Modele.lireDate(input.value);
    aide.textContent = r.erreur ? r.erreur : `→ ${Modele.dateFr(r.gedcom)}`;
    aide.classList.toggle("ko", !!r.erreur);
  }
  function fermer(force = false) {
    if (!force && modifie && !confirm("Abandonner les modifications en cours ?")) return;
    modifie = false;
    dlg.close();
  }
  dlg.addEventListener("cancel", e => { e.preventDefault(); fermer(); });

  /* ---------------- fiche d'une personne ---------------- */
  function formPersonne(p) {
    const n = p.naissance || {}, d = p.deces;
    return `<fieldset><legend>Identité</legend><div class="grille">` +
      champ("Prénoms", "prenoms", p.prenoms) + champ("Nom", "nom", p.nom) +
      `<div class="champ">Sexe<div class="radios">${radio("sexe", "M", "Homme", p.sexe || "U")}${radio("sexe", "F", "Femme", p.sexe || "U")}${radio("sexe", "U", "Inconnu", p.sexe || "U")}</div></div>` +
      champ("Noms d’usage ou d’épouse", "usage", (p.usage || []).join("\n"), { zone: true, lignes: 2, aide: "un par ligne" }) +
      champ("Surnom", "surnom", p.surnom) + champ("Préfixe (Dr, Sire…)", "prefixe", p.prefixe) + champ("Suffixe (IV, fils…)", "suffixe", p.suffixe) +
      `</div></fieldset>` +
      `<fieldset><legend>Naissance</legend><div class="grille">` + champDate("Date", "n_date", n.date) + champ("Lieu", "n_lieu", n.lieu) +
      champ("Note", "n_note", n.note, { large: true, zone: true, lignes: 2 }) + `</div></fieldset>` +
      `<fieldset><legend>Décès</legend><label class="radios"><input type="checkbox" name="decede" ${d ? "checked" : ""}> Personne décédée</label>` +
      `<div class="grille" data-si-decede ${d ? "" : "hidden"}>` + champDate("Date", "d_date", d?.date) + champ("Lieu", "d_lieu", d?.lieu) +
      champ("Cause", "d_cause", d?.cause) + champ("Note", "d_note", d?.note, { large: true, zone: true, lignes: 2 }) + `</div></fieldset>` +
      `<fieldset><legend>Métiers, titres et événements</legend>${liste("evenements", p.evenements || [], "+ Ajouter un métier, un titre ou un événement")}</fieldset>` +
      `<fieldset><legend>Notes</legend>${liste("notes", p.notes || [], "+ Ajouter une note")}</fieldset>` +
      `<fieldset><legend>Sources</legend>${liste("sources", p.sources || [], "+ Ajouter une source")}</fieldset>` +
      `<fieldset><legend>Coordonnées</legend><div class="grille">` +
      champ("E-mails", "emails", (p.emails || []).join("\n"), { zone: true, lignes: 2, aide: "un par ligne" }) +
      champ("Adresses", "adresses", (p.adresses || []).join("\n"), { zone: true, lignes: 2, aide: "une par ligne" }) + `</div></fieldset>`;
  }
  function lirePersonne(form, orig) {
    const v = n => (form.elements[n]?.value ?? "").trim();
    const lignes = n => v(n).split("\n").map(s => s.trim()).filter(Boolean);
    const r = { ...copie(orig) };
    r.prenoms = v("prenoms"); r.nom = v("nom"); r.sexe = form.elements.sexe.value || "U";
    r.usage = lignes("usage");
    r.surnom = v("surnom"); r.prefixe = v("prefixe"); r.suffixe = v("suffixe");
    r.naissance = { ...(orig.naissance || {}), date: lireDate(form.elements.n_date), lieu: v("n_lieu"), note: v("n_note") };
    r.deces = form.elements.decede.checked
      ? { ...(orig.deces || {}), date: lireDate(form.elements.d_date), lieu: v("d_lieu"), cause: v("d_cause"), note: v("d_note") } : undefined;
    if (r.deces && r.deces.date !== (orig.deces?.date || "")) delete r.deces.age;   // l'âge sera recalculé
    r.evenements = lireListe(form, "evenements");
    r.notes = lireListe(form, "notes");
    r.sources = lireListe(form, "sources");
    r.emails = lignes("emails"); r.adresses = lignes("adresses");
    return r;
  }
  const LIBELLES_CHAMPS = { prenoms: "identité", nom: "identité", sexe: "identité", usage: "identité", surnom: "identité",
    prefixe: "identité", suffixe: "identité", naissance: "naissance", deces: "décès", evenements: "métiers et événements",
    notes: "notes", sources: "sources", emails: "coordonnées", adresses: "coordonnées", photos: "photos", portrait: "photos" };
  /** Champs réellement modifiés (comparaison après normalisation). */
  function differences(avant, apres, nettoyer) {
    const a = nettoyer(avant), b = nettoyer(apres), res = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) res[k] = b[k];   // undefined = champ vidé
    }
    return res;
  }
  function modifierPersonne(id) {
    const orig = copie(pers(B(), id));
    ouvrirDialogue({
      titre: `Modifier la fiche de ${nomDe(orig)}`,
      sousTitre: "Dates en français : « 24/03/1951 », « mars 1951 », « vers 1800 », « avant 1700 », « entre 1850 et 1855 »…",
      corps: formPersonne(orig),
      supprimer: "Supprimer cette personne",
      apres: form => form.elements.decede.addEventListener("change", e => {
        form.querySelector("[data-si-decede]").hidden = !e.target.checked;
      }),
      surEnregistrer: form => {
        const diff = differences(orig, lirePersonne(form, orig), Modele.nettoyerPersonne);
        const cles = Object.keys(diff);
        if (!cles.length) return true;
        const quoi = [...new Set(cles.map(k => LIBELLES_CHAMPS[k] || k))].join(", ");
        executer({
          message: `Modifie ${nomDe({ ...orig, ...diff })} (${quoi})`,
          faire: d => { const p = pers(d, id); for (const k of cles) { if (diff[k] === undefined) delete p[k]; else p[k] = copie(diff[k]); } },
        });
      },
      surSupprimer: () => supprimerPersonne(id),
    });
  }
  function supprimerPersonne(id) {
    const p = P.get(id);
    const liens = [...(p?.fc || []), ...(p?.fs || [])].length;
    if (!confirm(`Supprimer définitivement ${nomId(id)} de l’arbre ?` + (liens ? "\nSes liens de famille seront défaits (les autres personnes restent)." : "") +
      "\n\nLa suppression reste visible et récupérable dans l’historique GitHub.")) return false;
    executer({
      message: `Supprime ${nomId(id)}`,
      faire: d => {
        pers(d, id);
        d.personnes = d.personnes.filter(x => x.id !== id);
        const touchees = [];
        for (const f of d.familles) {
          if (f.pere !== id && f.mere !== id && !(f.enfants || []).includes(id)) continue;
          touchees.push(f.id);
          if (f.pere === id) f.pere = "";
          if (f.mere === id) f.mere = "";
          f.enfants = (f.enfants || []).filter(c => c !== id);
        }
        nettoyerFamilles(d, touchees);
      },
    });
    toast(`${nomId(id)} a été supprimé(e).`);
  }

  /* ---------------- ajouter un parent, un enfant, un conjoint, un frère ou une sœur ---------------- */
  function champsNouvelle(nom, sexe) {
    return `<div class="grille">` + champ("Prénoms", "nv_prenoms", "") + champ("Nom", "nv_nom", nom) +
      `<div class="champ">Sexe<div class="radios">${radio("nv_sexe", "M", "Homme", sexe)}${radio("nv_sexe", "F", "Femme", sexe)}${radio("nv_sexe", "U", "Inconnu", sexe)}</div></div>` +
      champDate("Date de naissance", "nv_n_date", "") + champ("Lieu de naissance", "nv_n_lieu", "") +
      `<label class="champ"><span>&nbsp;</span><span class="radios"><label><input type="checkbox" name="nv_decede"> Décédé(e)</label></span></label>` +
      champDate("Date de décès", "nv_d_date", "") + `</div>`;
  }
  function lireNouvelle(form) {
    const v = n => (form.elements[n]?.value ?? "").trim();
    const p = { id: Modele.nouvelId("I"), prenoms: v("nv_prenoms"), nom: v("nv_nom"), sexe: form.elements.nv_sexe.value || "U" };
    if (!p.prenoms && !p.nom) throw new Error("Indiquez au moins un prénom ou un nom");
    const nd = lireDate(form.elements.nv_n_date), nl = v("nv_n_lieu");
    if (nd || nl) p.naissance = { date: nd, lieu: nl };
    const dd = lireDate(form.elements.nv_d_date);
    if (form.elements.nv_decede.checked || dd) p.deces = dd ? { date: dd } : {};
    return Modele.nettoyerPersonne(p);
  }
  function listeChoix(exclus) {
    return `<label class="champ large">Rechercher dans l’arbre<input type="search" data-recherche placeholder="Nom, prénom, année, lieu…" autocomplete="off"></label>` +
      `<input type="hidden" name="choisi"><div class="choix-res" data-resultats data-exclus="${attr(JSON.stringify(exclus))}"></div>`;
  }
  function brancherChoix(form) {
    const champR = form.querySelector("[data-recherche]"), res = form.querySelector("[data-resultats]");
    const exclus = new Set(JSON.parse(res.dataset.exclus));
    const maj = () => {
      const mots = fold(champR.value).split(/\s+/).filter(Boolean);
      if (!mots.length) { res.innerHTML = ""; return; }
      const trouves = D.personnes.filter(p => !exclus.has(p.i) && mots.every(m => p._s.includes(m))).slice(0, 30);
      res.innerHTML = trouves.map(p => `<button type="button" data-choix="${p.i}" aria-pressed="${form.elements.choisi.value === p.i}">` +
        `${avatar(p, "xs")}<span>${nomHtml(p)}<small>${esc(vie(p) || "dates inconnues")}${p.b?.p ? " · " + esc(ville(p.b.p)) : ""}</small></span></button>`).join("") ||
        '<p class="vide">Personne ne correspond.</p>';
    };
    champR.addEventListener("input", maj);
    res.addEventListener("click", e => {
      const b = e.target.closest("[data-choix]");
      if (!b) return;
      form.elements.choisi.value = b.dataset.choix;
      res.querySelectorAll("[data-choix]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    });
  }
  /** Fenêtre commune : nouvelle personne ou personne existante, puis operation(idLie, nouvelle|null). */
  function dialogueLien({ titre, sousTitre, nom = "", sexe = "U", exclus = [], controle, supp = "", lireSupp, operation }) {
    const corps = `<div class="onglets-ed"><button type="button" data-mode="nouvelle" aria-pressed="true">Nouvelle personne</button>` +
      `<button type="button" data-mode="existante" aria-pressed="false">Personne déjà dans l’arbre</button></div>` +
      `<div data-panneau="nouvelle">${champsNouvelle(nom, sexe)}</div><div data-panneau="existante" hidden>${listeChoix(exclus)}</div>${supp}`;
    ouvrirDialogue({
      titre, sousTitre, corps, enregistrer: "Ajouter",
      apres: form => {
        brancherChoix(form);
        form.querySelector(".onglets-ed").addEventListener("click", e => {
          const b = e.target.closest("[data-mode]");
          if (!b) return;
          form.querySelectorAll("[data-mode]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
          form.querySelectorAll("[data-panneau]").forEach(x => { x.hidden = x.dataset.panneau !== b.dataset.mode; });
          form.querySelector(`[data-panneau="${b.dataset.mode}"] input:not([type=hidden])`)?.focus();
        });
      },
      surEnregistrer: form => {
        const existante = form.querySelector('[data-mode="existante"]').getAttribute("aria-pressed") === "true";
        let nouvelle = null, idLie;
        if (existante) {
          idLie = form.elements.choisi.value;
          if (!idLie) throw new Error("Choisissez une personne dans la liste");
          const pb = controle?.(idLie);
          if (pb) throw new Error(pb);
        } else {
          nouvelle = lireNouvelle(form);
          idLie = nouvelle.id;
        }
        const op = operation(idLie, nouvelle, lireSupp?.(form));
        executer(op);
        toast(`${nouvelle ? nomDe(nouvelle) : nomId(idLie)} : lien ajouté.`);
      },
    });
  }
  const ascendants = id => fermeture(id, parentsIds), descendants = id => fermeture(id, enfantsIds);
  const fratrie = id => new Set((P.get(id)?.fc || []).flatMap(f => F[f]?.c || []).filter(x => x !== id));
  /** Liens impossibles : un ancêtre, un descendant ou un frère/une sœur ne peut pas devenir parent, enfant ou conjoint. */
  function lienImpossible(id, x, { anc = true, desc = true, frat = true } = {}) {
    const p = P.get(id);
    const qui = p ? nomTexte(p) : "cette personne";
    if (anc && ascendants(id).has(x)) return `Impossible : cette personne est un ancêtre de ${qui}`;
    if (desc && descendants(id).has(x)) return `Impossible : cette personne est un descendant de ${qui}`;
    if (frat && fratrie(id).has(x)) return `Impossible : cette personne est frère ou sœur de ${qui}`;
    return null;
  }
  const avecNouvelle = (d, nouvelle) => { if (nouvelle) d.personnes.push(copie(nouvelle)); };

  function ajouterParent(id) {
    const p = pers(B(), id), f0 = B().familles.find(f => (f.enfants || []).includes(id));
    const sexe = f0?.pere && !f0?.mere ? "F" : f0?.mere && !f0?.pere ? "M" : "U";
    const pere = f0?.pere ? pers(B(), f0.pere) : null;
    const fid = Modele.nouvelId("F");
    dialogueLien({
      titre: `Ajouter un parent à ${nomDe(p)}`, nom: sexe === "F" ? "" : (pere?.nom || p.nom || ""), sexe, exclus: [id],
      controle: x => lienImpossible(id, x, { anc: false }),
      operation: (parentId, nouvelle) => ({
        message: `Ajoute ${nouvelle ? nomDe(nouvelle) : nomId(parentId)} comme parent de ${nomDe(p)}`,
        faire: d => {
          avecNouvelle(d, nouvelle);
          const parent = pers(d, parentId), enfant = pers(d, id);
          let f = d.familles.find(x => (x.enfants || []).includes(id));
          if (!f) { f = { id: fid, pere: "", mere: "", enfants: [id] }; d.familles.push(f); }
          let role = parent.sexe === "F" ? "mere" : parent.sexe === "M" ? "pere" : (!f.pere ? "pere" : "mere");
          if (f.pere === parentId || f.mere === parentId) throw new Error(`${nomDe(parent)} est déjà parent de ${nomDe(enfant)}`);
          if (f[role]) throw new Error(`${nomDe(enfant)} a déjà ${role === "pere" ? "un père" : "une mère"} : ${nomId(f[role])}`);
          f[role] = parentId;
        },
      }),
    });
  }
  /** fid fourni : enfant de cette union. Sinon (bouton « + » de l'arbre) : on choisit l'union dans la fenêtre. */
  function ajouterEnfant(id, fid) {
    const p = pers(B(), id), nouvelleFid = Modele.nouvelId("F");
    const unions = fid ? [fam(B(), fid)] : B().familles.filter(f => f.pere === id || f.mere === id);
    const conjointDe = f => (f.pere === id ? f.mere : f.pere) || "";
    const choix = !fid && unions.length > 0;
    const f0 = unions[0] || null, autre0 = f0 ? conjointDe(f0) : "";
    const pere = p.sexe === "M" ? p : autre0 ? pers(B(), autre0) : null;
    const conjoints = unions.map(conjointDe).filter(Boolean);
    const supp = choix ? `<fieldset><legend>Autre parent</legend><label class="champ">Enfant de ${esc(nomDe(p))} et…` +
      `<select name="u_fam">${unions.map(f => `<option value="${esc(f.id)}">${esc(conjointDe(f) ? nomId(conjointDe(f)) : "conjoint inconnu")}</option>`).join("")}` +
      `<option value="">autre parent inconnu</option></select></label></fieldset>` : "";
    const titreAutre = !choix && autre0 ? " et " + nomId(autre0) : "";
    dialogueLien({
      titre: `Ajouter un enfant à ${nomDe(p)}${titreAutre}`,
      nom: pere?.nom || p.nom || "", exclus: [id, ...conjoints], supp,
      controle: x => lienImpossible(id, x, { desc: false }) ||
        conjoints.map(c => lienImpossible(c, x, { desc: false })).find(Boolean) || null,
      lireSupp: form => (choix ? form.elements.u_fam.value : fid) || null,
      operation: (enfantId, nouvelle, fidChoisi) => {
        const autre = fidChoisi ? conjointDe(unions.find(f => f.id === fidChoisi) || {}) : "";
        return {
          message: `Ajoute ${nouvelle ? nomDe(nouvelle) : nomId(enfantId)} comme enfant de ${nomDe(p)}${autre ? " et " + nomId(autre) : ""}`,
          faire: d => {
            avecNouvelle(d, nouvelle);
            const enfant = pers(d, enfantId), parent = pers(d, id);
            let cible = fidChoisi ? fam(d, fidChoisi) : null;
            if (!cible) {              // autre parent inconnu : famille à un seul parent
              cible = d.familles.find(x => x.id === nouvelleFid) ||
                { id: nouvelleFid, pere: parent.sexe === "F" ? "" : id, mere: parent.sexe === "F" ? id : "", enfants: [] };
              if (!d.familles.includes(cible)) d.familles.push(cible);
            }
            if ((cible.enfants || []).includes(enfantId)) throw new Error(`${nomDe(enfant)} est déjà leur enfant`);
            const ailleurs = d.familles.find(x => x !== cible && (x.enfants || []).includes(enfantId) && (x.pere || x.mere));
            if (ailleurs) throw new Error(`${nomDe(enfant)} a déjà des parents dans l’arbre : modifiez d’abord ses parents depuis sa fiche`);
            cible.enfants = [...(cible.enfants || []), enfantId];
          },
        };
      },
    });
  }
  function ajouterFratrie(id) {
    const p = pers(B(), id), nouvelleFid = Modele.nouvelId("F");
    const f0 = B().familles.find(f => (f.enfants || []).includes(id));
    const pere = f0?.pere ? pers(B(), f0.pere) : null;
    dialogueLien({
      titre: `Ajouter un frère ou une sœur à ${nomDe(p)}`, nom: pere?.nom || p.nom || "", exclus: [id],
      controle: x => lienImpossible(id, x, { frat: false }),
      operation: (autreId, nouvelle) => ({
        message: `Ajoute ${nouvelle ? nomDe(nouvelle) : nomId(autreId)} comme frère ou sœur de ${nomDe(p)}`,
        faire: d => {
          avecNouvelle(d, nouvelle);
          const autre = pers(d, autreId);
          let f = d.familles.find(x => (x.enfants || []).includes(id));
          if (!f) { f = { id: nouvelleFid, pere: "", mere: "", enfants: [id] }; d.familles.push(f); }
          if (f.enfants.includes(autreId)) throw new Error(`${nomDe(autre)} est déjà dans la même fratrie`);
          const ailleurs = d.familles.find(x => x !== f && (x.enfants || []).includes(autreId) && (x.pere || x.mere));
          if (ailleurs) throw new Error(`${nomDe(autre)} a déjà des parents dans l’arbre`);
          f.enfants = [...f.enfants, autreId];
          // une ancienne « fratrie » sans parents qui ne contenait que cette personne n'a plus lieu d'être
          const seules = d.familles.filter(x => x !== f && !x.pere && !x.mere && (x.enfants || []).includes(autreId));
          for (const x of seules) x.enfants = x.enfants.filter(c => c !== autreId);
          nettoyerFamilles(d, seules.map(x => x.id));
        },
      }),
    });
  }
  function ajouterUnion(id) {
    const p = pers(B(), id), fid = Modele.nouvelId("F");
    const supp = `<fieldset><legend>Mariage (facultatif)</legend><div class="grille">` +
      `<label class="champ"><span>&nbsp;</span><span class="radios"><label><input type="checkbox" name="u_marie"> Couple marié</label></span></label>` +
      champDate("Date du mariage", "u_date", "") + champ("Lieu du mariage", "u_lieu", "") + `</div></fieldset>`;
    dialogueLien({
      titre: `Ajouter une union pour ${nomDe(p)}`, sexe: p.sexe === "M" ? "F" : p.sexe === "F" ? "M" : "U", exclus: [id], supp,
      controle: x => lienImpossible(id, x),
      lireSupp: form => {
        const date = lireDate(form.elements.u_date), lieu = form.elements.u_lieu.value.trim();
        return form.elements.u_marie.checked || date || lieu ? { date, lieu } : null;
      },
      operation: (conjointId, nouvelle, mariage) => ({
        message: `Ajoute l’union de ${nomDe(p)} et ${nouvelle ? nomDe(nouvelle) : nomId(conjointId)}`,
        faire: d => {
          avecNouvelle(d, nouvelle);
          const a = pers(d, id), b = pers(d, conjointId);
          if (d.familles.some(f => (f.pere === id && f.mere === conjointId) || (f.pere === conjointId && f.mere === id)))
            throw new Error(`${nomDe(a)} et ${nomDe(b)} sont déjà en union`);
          const [pere, mere] = a.sexe === "F" || b.sexe === "M" ? [conjointId, id] : [id, conjointId];
          d.familles.push({ id: fid, pere, mere, enfants: [], ...(mariage ? { mariage } : {}) });
        },
      }),
    });
  }

  /* ---------------- famille (union ou parents) ---------------- */
  function modifierFamille(fid) {
    const orig = copie(fam(B(), fid));
    const membre = (id, role, libelle) => `<div class="membre" data-membre="${role}" data-id="${id}"><span>${esc(nomId(id))} <span class="vide">· ${libelle}</span></span>` +
      `<button type="button" data-retirer>Retirer de cette famille</button></div>`;
    const m = orig.mariage;
    const corps = `<fieldset><legend>Membres</legend><div class="membres">` +
      (orig.pere ? membre(orig.pere, "pere", "père / conjoint") : "") + (orig.mere ? membre(orig.mere, "mere", "mère / conjointe") : "") +
      (orig.enfants || []).map(c => membre(c, "enfant", "enfant")).join("") +
      `</div><p class="vide" style="font-size:13px">Retirer une personne défait seulement le lien : elle reste dans l’arbre.</p></fieldset>` +
      `<fieldset><legend>Mariage</legend><label class="radios"><input type="checkbox" name="marie" ${m ? "checked" : ""}> Couple marié</label>` +
      `<div class="grille">` + champDate("Date", "m_date", m?.date) + champ("Lieu", "m_lieu", m?.lieu) +
      champ("Note", "m_note", m?.note, { large: true, zone: true, lignes: 2 }) + `</div></fieldset>` +
      `<fieldset><legend>Autres événements</legend>${liste("evenements", orig.evenements || [], "+ Ajouter (divorce, contrat…)", TYPES_UNION)}</fieldset>` +
      `<fieldset><legend>Notes</legend>${liste("notes", orig.notes || [], "+ Ajouter une note")}</fieldset>` +
      `<fieldset><legend>Sources</legend>${liste("sources", orig.sources || [], "+ Ajouter une source")}</fieldset>`;
    const noms = [orig.pere, orig.mere].filter(Boolean).map(nomId).join(" et ") || "famille sans parents connus";
    ouvrirDialogue({
      titre: `Famille : ${noms}`, corps, supprimer: "Supprimer cette famille",
      apres: form => form.querySelector(".membres").addEventListener("click", e => {
        const b = e.target.closest("[data-retirer]");
        if (!b) return;
        const ligne = b.closest(".membre"), retire = ligne.classList.toggle("retire");
        ligne.style.textDecoration = retire ? "line-through" : "";
        ligne.style.opacity = retire ? ".55" : "";
        b.textContent = retire ? "Annuler le retrait" : "Retirer de cette famille";
        modifie = true;
      }),
      surEnregistrer: form => {
        const retires = [...form.querySelectorAll(".membre.retire")].map(x => ({ role: x.dataset.membre, id: x.dataset.id }));
        const v = n => form.elements[n].value.trim();
        const nouveau = { ...copie(orig) };
        for (const r of retires) {
          if (r.role === "enfant") nouveau.enfants = nouveau.enfants.filter(c => c !== r.id); else nouveau[r.role] = "";
        }
        nouveau.mariage = form.elements.marie.checked || v("m_date") || v("m_lieu")
          ? { ...(orig.mariage || {}), date: lireDate(form.elements.m_date), lieu: v("m_lieu"), note: v("m_note") } : undefined;
        nouveau.evenements = lireListe(form, "evenements");
        nouveau.notes = lireListe(form, "notes");
        nouveau.sources = lireListe(form, "sources");
        const diff = differences(orig, nouveau, Modele.nettoyerFamille);
        const cles = Object.keys(diff);
        if (!cles.length) return true;
        const ids = retires.map(r => r.id);
        executer({
          message: ids.length ? `Défait le lien de ${ids.map(nomId).join(", ")} avec la famille de ${noms}` : `Modifie la famille de ${noms}`,
          faire: d => {
            const f = fam(d, fid);
            for (const r of retires) {           // retraits appliqués sur l'état le plus récent
              if (r.role === "enfant") f.enfants = (f.enfants || []).filter(c => c !== r.id);
              else if (f[r.role] === r.id) f[r.role] = "";
            }
            for (const k of cles) {
              if (["pere", "mere", "enfants"].includes(k)) continue;
              if (diff[k] === undefined) delete f[k]; else f[k] = copie(diff[k]);
            }
            nettoyerFamilles(d, [fid]);
          },
        });
      },
      surSupprimer: () => {
        if (!confirm(`Supprimer cette famille (${noms}) ?\nLes personnes restent dans l’arbre, seuls les liens de cette famille disparaissent.`)) return false;
        executer({
          message: `Supprime la famille de ${noms}`,
          faire: d => { fam(d, fid); d.familles = d.familles.filter(f => f.id !== fid); },
        });
      },
    });
  }

  /* ---------------- photos ---------------- */
  async function chargerImage(octets) {
    const url = URL.createObjectURL(new Blob([octets]));
    const img = new Image();
    img.src = url;
    try { await img.decode(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    return img;
  }
  async function versJpeg(canvas, qualite) {
    const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", qualite));
    return new Uint8Array(await blob.arrayBuffer());
  }
  /** Photo réduite (côté le plus long ≤ max) pour garder le dépôt léger. */
  async function reduire(octets, max = 1600) {
    const img = await chargerImage(octets);
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return versJpeg(c, 0.85);
  }
  /** Vignette carrée (centrée, un peu vers le haut : là où sont les visages) pour la photo de profil. */
  async function vignette(octets, taille = 400) {
    const img = await chargerImage(octets);
    const w = img.naturalWidth, h = img.naturalHeight, cote = Math.min(w, h);
    const c = document.createElement("canvas");
    c.width = c.height = Math.min(taille, cote);
    c.getContext("2d").drawImage(img, (w - cote) / 2, Math.max(0, (h - cote) * 0.3), cote, cote, 0, 0, c.width, c.height);
    return versJpeg(c, 0.85);
  }
  async function empreinte(octets) {
    try {
      const h = await crypto.subtle.digest("SHA-1", octets);
      return [...new Uint8Array(h)].slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
    } catch { return Modele.nouvelId("p"); }
  }
  function gererPhotos(id) {
    const orig = copie(pers(B(), id));
    const nouvelles = new Map();            // chemin -> octets des photos ajoutées
    const carte = (x, portraitActuel) => `<div class="photo-ed" data-photo="${attr(x.fichier)}" ${portraitActuel ? "data-portrait" : ""}>` +
      imgPhoto(x.fichier, x.titre || "") + `<div class="corps">` +
      (portraitActuel ? `<span class="vide">Photo de profil actuelle</span>` : `<input type="text" data-titre placeholder="Légende" value="${attr(x.titre)}">`) +
      `<div class="ligne"><label><input type="radio" name="profil" value="${attr(x.fichier)}" ${portraitActuel ? "checked" : ""}> Profil</label>` +
      `<button type="button" data-retirer-photo>Retirer</button></div></div></div>`;
    const corps = `<p class="vide" style="font-size:13.5px;margin-top:4px">Choisissez « Profil » pour la photo affichée à côté du nom (une vignette carrée est créée automatiquement).</p>` +
      `<div class="photos-ed">${orig.portrait ? carte({ fichier: orig.portrait }, true) : ""}${(orig.photos || []).map(x => carte(x, false)).join("")}</div>` +
      `<label class="radios" style="margin-top:8px"><input type="radio" name="profil" value="" ${orig.portrait ? "" : "checked"}> Pas de photo de profil</label>` +
      `<label class="ajout" style="display:inline-block">+ Ajouter des photos<input type="file" accept="image/*" multiple hidden data-fichiers></label>`;
    ouvrirDialogue({
      titre: `Photos de ${nomDe(orig)}`, corps,
      apres: form => {
        form.querySelector("[data-fichiers]").addEventListener("change", async e => {
          const grille = form.querySelector(".photos-ed");
          for (const f of e.target.files) {
            try {
              const octets = await reduire(new Uint8Array(await f.arrayBuffer()));
              const chemin = `photos/${await empreinte(octets)}.jpg`;
              nouvelles.set(chemin, octets);
              Depot.ajouterLocal(chemin, octets);
              grille.insertAdjacentHTML("beforeend", carte({ fichier: chemin, titre: f.name.replace(/\.[^.]+$/, "").replace(/^(IMG|DSC|PXL)[-_]?\d.*$/i, "") }, false));
              modifie = true;
            } catch { toast(`Image illisible : ${f.name}`, true); }
          }
          e.target.value = "";
        });
        form.querySelector(".photos-ed").addEventListener("click", e => {
          const b = e.target.closest("[data-retirer-photo]");
          if (!b) return;
          const carteEl = b.closest(".photo-ed");
          if (carteEl.querySelector('input[name="profil"]').checked) form.querySelector('input[name="profil"][value=""]').checked = true;
          carteEl.remove();
          modifie = true;
        });
      },
      surEnregistrer: async form => {
        const choix = form.querySelector('input[name="profil"]:checked')?.value || "";
        const photos = [...form.querySelectorAll(".photo-ed:not([data-portrait])")].map(c => {
          const o = (orig.photos || []).find(x => x.fichier === c.dataset.photo) || { fichier: c.dataset.photo };
          return { ...o, titre: c.querySelector("[data-titre]").value.trim() };
        });
        const fichiers = [];
        let portrait = orig.portrait || "";
        if (!choix) portrait = "";
        else if (choix !== orig.portrait) {
          const source = nouvelles.get(choix) || await Depot.octetsPhoto(choix);
          if (!source) throw new Error("Photo introuvable pour créer la vignette");
          const v = await vignette(source);
          portrait = `photos/${await empreinte(v)}-profil.jpg`;
          fichiers.push({ chemin: portrait, octets: v });
          Depot.ajouterLocal(portrait, v);
        }
        const utilisees = new Set(photos.map(x => x.fichier));
        for (const [chemin, octets] of nouvelles) if (utilisees.has(chemin)) fichiers.push({ chemin, octets });
        const diff = differences(orig, { ...orig, photos, portrait }, Modele.nettoyerPersonne);
        if (!Object.keys(diff).length) return true;
        const ajoutees = fichiers.filter(f => utilisees.has(f.chemin)).length;
        executer({
          message: `Photos de ${nomDe(orig)}` + (ajoutees ? ` : ${ajoutees} ajoutée${ajoutees > 1 ? "s" : ""}` : " : modifiées"),
          fichiers,
          faire: d => {
            const p = pers(d, id);
            if ("photos" in diff) { if (diff.photos) p.photos = copie(diff.photos); else delete p.photos; }
            if ("portrait" in diff) { if (diff.portrait) p.portrait = diff.portrait; else delete p.portrait; }
          },
        });
      },
    });
  }

  /* ---------------- menu : nouvelle personne, historique ---------------- */
  function nouvellePersonne() {
    ouvrirDialogue({
      titre: "Nouvelle personne", sousTitre: "Elle ne sera reliée à personne : ajoutez ensuite ses liens depuis sa fiche.",
      corps: champsNouvelle("", "U"), enregistrer: "Créer",
      surEnregistrer: form => {
        const p = lireNouvelle(form);
        executer({ message: `Ajoute ${nomDe(p)}`, faire: d => { d.personnes.push(copie(p)); } });
        location.hash = "#" + p.id;
      },
    });
  }
  async function historique() {
    ouvrirDialogue({ titre: "Historique des modifications", corps: '<p class="vide">Chargement…</p>', enregistrer: "" });
    const corps = dlg.querySelector(".ed-corps");
    try {
      const commits = await Depot.historique(60);
      corps.innerHTML = `<div class="historique">` + commits.map(c => {
        const d = new Date(c.commit.author.date);
        return `<div class="h-ligne"><div>${d.toLocaleDateString("fr")}<small>${d.toLocaleTimeString("fr", { hour: "2-digit", minute: "2-digit" })}</small></div>` +
          `<div>${esc(c.commit.message)}<small>${esc(c.commit.author.name || c.author?.login || "")} · ` +
          `<a href="${esc(c.html_url)}" target="_blank" rel="noopener noreferrer">voir le détail sur GitHub</a></small></div></div>`;
      }).join("") + `</div><p class="vide" style="font-size:13px">Pour annuler une modification : ouvrez son détail sur GitHub, ou demandez-la ici en la refaisant à la main.</p>`;
    } catch (e) {
      corps.innerHTML = `<p class="erreur">${esc(e.message)}</p>`;
    }
  }

  /* ---------------- branchements ---------------- */
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-edit]");
    if (!b || !Depot.donnees) return;
    e.preventDefault();
    const { edit, id, fam: fid } = b.dataset;
    try {
      ({
        personne: () => modifierPersonne(id),
        famille: () => modifierFamille(fid),
        "ajout-parent": () => ajouterParent(id),
        "ajout-enfant": () => ajouterEnfant(id, fid),
        "ajout-fratrie": () => ajouterFratrie(id),
        "ajout-union": () => ajouterUnion(id),
        photos: () => gererPhotos(id),
      })[edit]?.();
    } catch (err) { toast(err.message, true); }
  });
  function menu(action) {
    if (action === "nouvelle") nouvellePersonne();
    else if (action === "historique") historique();
  }
  return { menu, _tests: { formPersonne, lirePersonne, differences } };
})();
