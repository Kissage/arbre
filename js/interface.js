"use strict";
/* Interface : liste, fiches, ascendance, fresque et statistiques. Les données viennent du dépôt (depot.js),
   converties au format d'affichage par modele.js ; elles sont remplacées à chaque modification (installerDonnees). */
const D = { titre: "", personnes: [], familles: {}, histoire: HISTOIRE, statistiques: null };
const P = new Map();
let F = {};
let tousIds = [];
const $ = s => document.querySelector(s);
const app = $("#app"), listEl = $("#list"), detailEl = $("#detail");

/* ---------- utilitaires ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { } },
};
const linkify = s => esc(s).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g,
  '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
const roman = n => { const t = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]; let r = ""; for (const [v, s] of t) while (n >= v) { r += s; n -= v; } return r; };

const inconnu = p => !p.g && !p.n;
const initiales = p => inconnu(p) ? "?" : ((p.g || "").trim()[0] || "") + ((p.n || "").trim()[0] || "");
const nomTexte = p => inconnu(p) ? (p.mn?.[0] || "Inconnu") : [p.pf, p.g, p.n, p.sf].filter(Boolean).join(" ");
const nomHtml = p => inconnu(p) ? esc(p.mn?.[0] || "Inconnu(e)") :
  [esc(p.pf), esc(p.g), p.n ? `<span class="ln">${esc(p.n)}</span>` : "", esc(p.sf)].filter(Boolean).join(" ");
const by = p => p.b?.y ?? null;
const vie = p => {
  const b = by(p), d = p.dt?.y;
  if (!b && !d) return p.dt ? "décédé" : "";
  return `${b ?? "?"} – ${d ?? (p.dt ? "?" : "")}`.trim();
};
const sexeLabel = { M: "Homme", F: "Femme", U: "Sexe inconnu" };
const ville = s => (s || "").split(",")[0].trim();

// Photos : stockées dans le dépôt privé, lues à la demande quand elles deviennent visibles (<img data-ph="chemin">),
// puis gardées en cache dans le navigateur.
const photosVisibles = new IntersectionObserver(entrees => {
  for (const en of entrees) {
    if (!en.isIntersecting) continue;
    const img = en.target;
    photosVisibles.unobserve(img);
    Depot.urlPhoto(img.dataset.ph).then(u => { if (u) img.src = u; else img.remove(); });
  }
}, { rootMargin: "300px" });
new MutationObserver(mutations => {
  for (const m of mutations) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.matches?.("img[data-ph]")) photosVisibles.observe(n);
    n.querySelectorAll?.("img[data-ph]").forEach(i => photosVisibles.observe(i));
  }
}).observe(document.body, { childList: true, subtree: true });
const imgPhoto = (chemin, alt = "", attrs = "") => `<img data-ph="${esc(chemin)}" alt="${esc(alt)}" ${attrs}>`;
function avatar(p, cls = "") {
  return `<span class="av ${p.x} ${cls}" aria-hidden="true">${esc(initiales(p))}${p.av ? imgPhoto(p.av) : ""}</span>`;
}
function chip(id, extra = "", base = "#") {
  const p = P.get(id);
  if (!p) return "";
  return `<a class="pc ${p.x}" href="${base}${id}" data-id="${id}">${avatar(p, "xs")}<span class="t"><span>${nomHtml(p)}</span>` +
    `<span class="s">${esc(vie(p))}${extra ? " · " + esc(extra) : ""}</span></span></a>`;
}
const trierParNaissance = ids => ids.slice().sort((a, b) => (by(P.get(a)) ?? 1e9) - (by(P.get(b)) ?? 1e9));

/* ---------- données ---------- */
/** Remplace les données affichées (chargement initial, puis après chaque modification). */
function installerDonnees(aff) {
  D.titre = aff.titre;
  D.personnes = aff.personnes;
  D.familles = F = aff.familles;
  D.statistiques = null;               // recalculées à l'ouverture de l'onglet
  P.clear();
  for (const p of aff.personnes) {
    P.set(p.i, p);
    p._s = fold([p.g, p.n, ...(p.mn || []), p.nk, p.i, p.b?.p, p.dt?.p, p.b?.y, p.dt?.y,
      ...(p.e || []).flatMap(e => [e.v, e.p])].filter(Boolean).join(" "));
    p._k = fold(p.n) + "\u0001" + fold(p.g);
  }
  tousIds = aff.personnes.map(p => p.i);
}

/* ---------- liste ---------- */
const etat = { q: "", filtres: new Set(), tri: store.get("tri", "nom"), courant: null };
$("#tri").value = etat.tri;

function visibles() {
  const mots = fold(etat.q).split(/\s+/).filter(Boolean);
  const f = etat.filtres;
  const res = D.personnes.filter(p =>
    (!f.has("M") || p.x === "M") && (!f.has("F") || p.x === "F") &&
    (!f.has("photo") || p.av || p.ph) &&
    (!f.has("vivant") || (!p.dt && (by(p) === null || by(p) > 1910))) &&
    mots.every(m => p._s.includes(m)));
  if (etat.tri === "naissance")
    res.sort((a, b) => (by(a) ?? 1e9) - (by(b) ?? 1e9) || a._k.localeCompare(b._k));
  else
    res.sort((a, b) => (!a.n - !b.n) || a._k.localeCompare(b._k, "fr") || (by(a) ?? 0) - (by(b) ?? 0));
  return res;
}
function groupe(p) {
  if (etat.tri === "naissance") { const y = by(p); return y === null ? "Date inconnue" : `${roman(Math.floor(y / 100) + 1)}ᵉ siècle`; }
  const c = fold(p.n).trim()[0];
  return c && /[a-z]/.test(c) ? c.toUpperCase() : "?";
}
function renderListe() {
  const vs = visibles();
  let html = "", g = null;
  for (const p of vs) {
    const gr = groupe(p);
    if (gr !== g) { g = gr; html += `<div class="grp">${esc(gr)}</div>`; }
    const lieu = ville(p.b?.p);
    html += `<a class="row" href="#${p.i}" data-id="${p.i}"${p.i === etat.courant ? ' aria-current="true"' : ""}>` +
      `${avatar(p)}<span class="t"><span class="n">${nomHtml(p)}</span>` +
      `<span class="s">${esc(vie(p))}${lieu ? " · " + esc(lieu) : ""}</span></span></a>`;
  }
  listEl.innerHTML = html || '<p class="vide" style="padding:14px">Aucun résultat.</p>';
  $("#count").textContent = vs.length === tousIds.length ? `${vs.length.toLocaleString("fr")} personnes`
    : `${vs.length.toLocaleString("fr")} sur ${tousIds.length.toLocaleString("fr")} personnes`;
}

/* ---------- fiche ---------- */
function ligneEvenement(e) {
  const d = e.d || "";
  return `<div class="ev"><div class="d">${esc(d)}</div><div><b>${esc(e.t)}</b>${e.v ? " — " + esc(e.v) : ""}` +
    `${e.p ? `<small>${esc(e.p)}</small>` : ""}${e.a ? `<small>À ${esc(e.a)}</small>` : ""}` +
    `${(e.n || []).map(n => `<small>${esc(n)}</small>`).join("")}</div></div>`;
}
function fait(label, e) {
  if (!e) return "";
  const quand = e.d || (e.inc ? "date inconnue" : "");
  const corps = [quand, e.p].filter(Boolean);
  if (!corps.length && !e.a && !e.c && !(e.n || []).length) return e.inc ? `<dt>${label}</dt><dd>oui (date inconnue)</dd>` : "";
  return `<dt>${label}</dt><dd>${esc(quand)}${quand && e.p ? "<small>" + esc(e.p) + "</small>" : esc(e.p || "")}` +
    `${e.a ? `<small>À l’âge de ${esc(e.a)}</small>` : ""}${e.c ? `<small>Cause : ${esc(e.c)}</small>` : ""}` +
    `${(e.n || []).map(n => `<small>${esc(n)}</small>`).join("")}</dd>`;
}
function texteRepliable(t) {
  const long = t.length > 700 || t.split("\n").length > 12;
  return `<div class="note${long ? " clamp" : ""}">${linkify(t)}</div>` +
    (long ? '<button class="more" type="button">Tout afficher</button>' : "");
}

const parentsIds = id => (P.get(id)?.fc || []).flatMap(f => F[f] ? [F[f].h, F[f].w] : []).filter(x => x && P.has(x));
const enfantsIds = id => [...new Set((P.get(id)?.fs || []).flatMap(f => F[f]?.c || []))].filter(x => P.has(x));
function fermeture(id, voisins) {   // tous les ascendants (ou descendants) d'une personne
  const s = new Set(), q = [id];
  for (let i = 0; i < q.length; i++) for (const x of voisins(q[i])) if (x !== id && !s.has(x)) { s.add(x); q.push(x); }
  return s;
}
function aDesAscendants(p) { return parentsIds(p.i).length > 0; }
// Mot désignant une génération d'ancêtre (1 = parent, 2 = grand-parent…) ; null au-delà, faute de nom d'usage.
function libGeneration(g, sexe) {
  const f = sexe === "F";
  const noms = ["", f ? "mère" : "père", f ? "grand-mère" : "grand-père", f ? "arrière-grand-mère" : "arrière-grand-père",
    f ? "trisaïeule" : "trisaïeul", f ? "quadrisaïeule" : "quadrisaïeul"];
  return noms[g] || null;
}

function libDescendance(g, sexe) {     // g = 1 enfant, 2 petit-enfant…
  const f = sexe === "F";
  const noms = ["", f ? "fille" : "fils", f ? "petite-fille" : "petit-fils", f ? "arrière-petite-fille" : "arrière-petit-fils",
    f ? "arrière-arrière-petite-fille" : "arrière-arrière-petit-fils"];
  return noms[g] || null;
}

// Arbre d'ascendance (vers la droite) et de descendance (vers la gauche), chargé progressivement : seules les
// branches qui entrent dans la zone visible sont dépliées ; les boutons › et ‹ déplient une branche à la main.
// Chaque carte a un bouton « + » pour ajouter un enfant. Après une modification, l'arbre se reconstruit avec les
// mêmes branches dépliées et à la même position.
let pedObs = null;
let pedMemo = { id: null, ouverts: new Set(), defilement: null };
function monterAscendance(wrap, id) {
  pedObs?.disconnect();
  const MAX = 2500;   // garde-fou : au-delà, le dépliage devient manuel
  const info = wrap.closest(".card").querySelector(".pedinfo");
  const memeFiche = pedMemo.id === id;
  if (!memeFiche) pedMemo = { id, ouverts: new Set(), defilement: null };
  const noeuds = new Map();   // chemin -> élément
  let total = 0, defile = memeFiche && !!pedMemo.defilement;
  const majInfo = () => {
    const reste = wrap.querySelectorAll(".pd-more, .pd-moins").length;
    info.textContent = `${total.toLocaleString("fr")} personne${total > 1 ? "s" : ""} chargée${total > 1 ? "s" : ""}` +
      (reste ? (total >= MAX ? " · cliquez sur › ou ‹ pour déplier" : " · défilez pour charger la suite") : " · arbre complet");
  };
  const bouton = (classe, texte, titre, sens) => {
    const b = document.createElement("button");
    b.className = classe; b.type = "button"; b.textContent = texte; b.title = titre; b.dataset.sens = sens;
    pedObs.observe(b);
    return b;
  };
  const cellule = (q, gen, self) => {
    const c = document.createElement("span");
    c.className = "pn-cel";
    const a = document.createElement("a");
    a.className = `pn ${q.x}${self ? " self" : ""}`; a.href = "#" + q.i; a.dataset.id = q.i; a.dataset.gen = gen;
    a.title = gen ? "Voir ses informations et sa génération" : "Afficher les informations de cette personne";
    a.innerHTML = `<span class="n">${nomHtml(q)}</span><span class="s">${esc(vie(q))}</span>`;
    const plus = document.createElement("button");
    plus.className = "pd-plus"; plus.type = "button"; plus.textContent = "+";
    plus.title = `Ajouter un enfant à ${nomTexte(q)}`; plus.setAttribute("aria-label", plus.title);
    plus.dataset.edit = "ajout-enfant"; plus.dataset.id = q.i;
    c.append(a, plus);
    total++;
    return c;
  };
  // sens : "a" = ascendant (parents à droite), "d" = descendant (enfants à gauche), "r" = personne de la fiche
  const noeud = (q, gen, sens, chemin) => {
    const d = document.createElement("div");
    d.className = sens === "d" ? "pdd" : "pd";
    d.dataset.id = q.i; d.dataset.gen = gen; d.dataset.chemin = chemin;
    noeuds.set(chemin, d);
    const cel = cellule(q, gen, sens === "r");
    const aParents = sens !== "d" && parentsIds(q.i).length, aEnfants = sens !== "a" && enfantsIds(q.i).length;
    if (sens === "r") {
      if (aEnfants) d.append(bouton("pd-moins", "‹", "Charger les descendants", "d"));
      d.append(cel);
      if (aParents) d.append(bouton("pd-more", "›", "Charger les ancêtres", "a"));
    } else if (sens === "a") {
      d.append(cel);
      if (aParents) d.append(bouton("pd-more", "›", "Charger les ancêtres", "a"));
    } else {
      d.append(cel);            // .pdd est en « row-reverse » : les enfants s'affichent à gauche de la carte
      if (aEnfants) d.append(bouton("pd-moins", "‹", "Charger les descendants", "d"));
    }
    return d;
  };
  const etendre = (d, sens) => {
    const b = d.querySelector(`:scope > .${sens === "a" ? "pd-more" : "pd-moins"}`);
    if (!b) return;
    pedObs.unobserve(b);
    const gen = +d.dataset.gen || 0;
    const bloc = document.createElement("div");
    if (sens === "a") {
      bloc.className = "pd-anc";
      for (const x of parentsIds(d.dataset.id)) bloc.append(noeud(P.get(x), gen + 1, "a", `${d.dataset.chemin}/a${x}`));
    } else {
      bloc.className = "pd-desc";
      for (const x of trierParNaissance(enfantsIds(d.dataset.id))) bloc.append(noeud(P.get(x), gen - 1, "d", `${d.dataset.chemin}/d${x}`));
    }
    b.replaceWith(bloc);
    pedMemo.ouverts.add(`${d.dataset.chemin}|${sens}`);
    majInfo();
    centrer();          // des descendants ajoutés à gauche décalent la personne : on la garde en vue
  };
  pedObs = new IntersectionObserver(entrees => {
    for (const en of entrees) if (en.isIntersecting && total < MAX) etendre(en.target.parentElement, en.target.dataset.sens);
  }, { root: wrap, rootMargin: "120px 240px 120px 240px" });
  wrap._etendre = (b) => etendre(b.parentElement, b.dataset.sens);
  wrap.replaceChildren(noeud(P.get(id), 0, "r", ""));
  // même fiche qu'avant (après une modification) : on redéplie les mêmes branches, dans le même ordre
  if (memeFiche) for (const cle of [...pedMemo.ouverts]) {
    const [chemin, sens] = cle.split("|");
    const d = noeuds.get(chemin);
    if (d) etendre(d, sens); else pedMemo.ouverts.delete(cle);
  }
  majInfo();
  wrap.addEventListener("scroll", () => { pedMemo.defilement = [wrap.scrollLeft, wrap.scrollTop]; }, { passive: true });
  if (memeFiche && pedMemo.defilement) [wrap.scrollLeft, wrap.scrollTop] = pedMemo.defilement;
  // sinon, la personne reste au milieu de la zone tant que l'utilisateur n'a pas fait défiler lui-même
  for (const ev of ["wheel", "touchstart", "pointerdown"]) wrap.addEventListener(ev, () => { defile = true; }, { once: true, passive: true });
  function centrer() {
    if (defile) return;
    const s = wrap.querySelector(".pn.self");
    if (!s) return;
    const r = s.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    wrap.scrollTop += r.top - w.top - (wrap.clientHeight - r.height) / 2;
    wrap.scrollLeft += r.left - w.left - (wrap.clientWidth - r.width) / 2;
  }
  for (const t of [120, 350, 800]) setTimeout(() => { centrer(); majInfo(); }, t);
}

/* ---------- panneau d'aperçu : informations d'une personne sans quitter la fiche courante ---------- */
const peekEl = $("#peek");
function fermerPeek() {
  peekEl.hidden = true; app.classList.remove("has-peek"); etat.peek = null;
  detailEl.querySelectorAll(".pn.on").forEach(n => n.classList.remove("on"));
}
function ouvrirPeek(id, gen) {
  const p = P.get(id);
  if (!p) return;
  etat.peek = id;
  const chips = (ids, extra) => ids.length ? `<div class="people">${ids.map(i => chip(i, extra(i))).join("")}</div>` : "";
  const parents = parentsIds(id), unions = [...new Set((p.fs || []).map(f => F[f]).filter(Boolean).map(f => f.h === id ? f.w : f.h).filter(x => x && P.has(x)))];
  const enfants = trierParNaissance(enfantsIds(id));
  const anc = fermeture(id, parentsIds).size, desc = fermeture(id, enfantsIds).size;
  const prof = (p.e || []).filter(e => e.t === "Profession" && e.v).map(e => e.v);
  const autres = (p.e || []).filter(e => !["Profession", "Inhumation", "Baptême", "Résidence"].includes(e.t)).slice(0, 4);
  const faits = fait("Naissance", p.b) + fait("Décès", p.dt) +
    (p.e || []).filter(e => e.t === "Inhumation" || e.t === "Baptême").map(e => fait(e.t, e)).join("") +
    (prof.length ? `<dt>Profession</dt><dd>${[...new Set(prof)].slice(0, 4).map(esc).join(" · ")}</dd>` : "");
  const note = (p.nt || [])[0];
  let h = `<button class="peek-x" type="button" aria-label="Fermer le panneau" title="Fermer (Échap)">×</button>` +
    `<header class="hd">${avatar(p, "lg")}<div><h2>${nomHtml(p)}</h2>` +
    `<div class="alias">${esc(vie(p) || "dates inconnues")}${p.dt?.a ? " · à " + esc(p.dt.a) : ""}</div>` +
    `<div class="badges"><span class="badge ${p.x}">${sexeLabel[p.x] || sexeLabel.U}</span></div></div></header>`;
  // génération par rapport à la personne de la fiche affichée (uniquement quand on vient de cliquer une carte
  // de son arbre d’ascendance : gen y vaut sa profondeur exacte dans cet arbre, 1 = parent, 2 = grand-parent…)
  if (gen) {
    const racine = P.get(etat.courant);
    if (racine) {
      const n = Math.abs(gen), desc = gen < 0;
      const rel = desc ? libDescendance(n, p.x) : libGeneration(n, p.x), nomRacine = esc(nomTexte(racine));
      h += rel
        ? `<p class="gen-rel">${esc(rel.charAt(0).toUpperCase() + rel.slice(1))} de <b>${nomRacine}</b> <span class="gen-n">génération ${desc ? "+" : "−"}${n}</span></p>`
        : `<p class="gen-rel"><b>${n}ᵉ génération</b> ${desc ? "après" : "avant"} ${nomRacine}</p>`;
    }
  }
  h += `<div class="actions"><a class="btn primary" href="#${id}">Ouvrir sa fiche</a><a class="btn" href="#fresque:${id}">Voir sur la fresque</a></div>` +
    `<p class="hint">Sa fiche affiche sa famille et son propre arbre d’ascendance.</p>`;
  h += `<h4>Vie</h4>${faits ? `<dl class="facts">${faits}</dl>` : '<p class="vide">Aucune date ni lieu connu.</p>'}`;
  if (anc || desc) h += `<p class="hint">${anc} ancêtre${anc > 1 ? "s" : ""} connu${anc > 1 ? "s" : ""} · ${desc} descendant${desc > 1 ? "s" : ""}</p>`;
  if (parents.length) h += `<h4>Parents</h4>${chips(parents, i => P.get(i)?.x === "F" ? "mère" : "père")}`;
  if (unions.length) h += `<h4>${unions.length > 1 ? "Unions" : "Union"}</h4>${chips(unions, () => "")}`;
  if (enfants.length) h += `<h4>Enfants (${enfants.length})</h4>${chips(enfants, i => P.get(i)?.x === "F" ? "fille" : "fils")}`;
  if (autres.length) h += `<h4>Parcours</h4><div class="evs">${autres.map(ligneEvenement).join("")}</div>`;
  if (note) h += `<h4>Note</h4><div class="note">${linkify(note.length > 420 ? note.slice(0, 420).replace(/\s+\S*$/, "") + " […]" : note)}</div>`;
  if (p.s?.length) h += `<p class="hint">${p.s.length} source${p.s.length > 1 ? "s" : ""} citée${p.s.length > 1 ? "s" : ""} — visibles sur sa fiche.</p>`;
  peekEl.innerHTML = h;
  peekEl.hidden = false; peekEl.scrollTop = 0;
  app.classList.add("has-peek");
  detailEl.querySelectorAll(".pn.on").forEach(n => n.classList.remove("on"));
  detailEl.querySelectorAll(`.pn[data-id="${id}"]`).forEach(n => n.classList.add("on"));
}
peekEl.addEventListener("click", e => {
  if (e.target.closest(".peek-x")) { fermerPeek(); return; }
  const c = e.target.closest("a.pc");
  if (c && !(e.ctrlKey || e.metaKey || e.shiftKey || e.button)) { e.preventDefault(); ouvrirPeek(c.dataset.id); }
});

function renderFiche(id) {
  const p = P.get(id);
  if (!p) { detailEl.innerHTML = '<p class="vide">Personne introuvable.</p>'; return; }
  const famC = (p.fc || []).map(f => F[f]).filter(Boolean);
  const famS = (p.fs || []).map(f => ({ id: f, f: F[f] })).filter(x => x.f);

  // fratrie : enfants des familles où p est enfant ; demi-fratrie : autres familles des parents
  const pleins = new Set(), demis = new Set();
  for (const f of famC) f.c.forEach(c => c !== id && pleins.add(c));
  for (const f of famC) for (const parent of [f.h, f.w]) {
    const pp = P.get(parent);
    for (const fid of pp?.fs || []) if (F[fid] && !famC.includes(F[fid])) F[fid].c.forEach(c => c !== id && !pleins.has(c) && demis.add(c));
  }
  const libFratrie = c => { const q = P.get(c); return q.x === "F" ? "sœur" : q.x === "M" ? "frère" : "frère/sœur"; };

  const age = p.dt?.a ? ` (à ${p.dt.a})` : "";
  const alias = [];
  if (p.mn?.length) alias.push(`Nom d’usage / d’épouse : ${p.mn.map(esc).join(", ")}`);
  if (p.nk) alias.push(`« ${esc(p.nk)} »`);

  const ed = (action, texte, attrs = "") => `<button class="ed" type="button" data-edit="${action}" data-id="${esc(id)}" ${attrs}>${texte}</button>`;
  let h = `<article class="fiche"><button class="btn back" type="button">← Retour à la liste</button>`;
  h += `<header class="hd">${avatar(p, "lg")}<div><h2>${nomHtml(p)}</h2>` +
    `${alias.length ? `<div class="alias">${alias.join(" · ")}</div>` : ""}` +
    `<div class="badges"><span class="badge ${p.x}">${sexeLabel[p.x] || sexeLabel.U}</span>` +
    `${vie(p) ? `<span class="badge">${esc(vie(p))}${esc(age)}</span>` : ""}` +
    `<span class="badge" title="Identifiant de la personne">${esc(p.i)}</span>` +
    `<a class="badge" href="#fresque:${p.i}" style="text-decoration:none">🗺 Voir sur la fresque</a></div>` +
    `<div class="fiche-actions"><button class="btn primary" type="button" data-edit="personne" data-id="${esc(id)}">✏️ Modifier la fiche</button>` +
    (id === D.racine ? `<span class="badge">★ Ma fiche</span>` : `<button class="btn" type="button" data-ma-fiche="${esc(id)}" title="Page d’accueil de l’application, sur cet appareil">☆ Définir comme ma fiche</button>`) +
    `</div></div></header>`;

  // Vie
  const faits = fait("Naissance", p.b) + fait("Décès", p.dt) +
    (p.e || []).filter(e => e.t === "Inhumation" || e.t === "Baptême").map(e => fait(e.t, e)).join("");
  h += `<section class="card"><h3>Vie</h3>` +
    (faits ? `<dl class="facts">${faits}</dl>` : '<p class="vide">Aucune date ni lieu connu.</p>') + `</section>`;

  // Famille
  let fam = "";
  const nbParents = famC.length ? [famC[0].h, famC[0].w].filter(Boolean).length : 0;
  fam += `<h4>Parents${(p.fc || []).map(fid => ed("famille", "modifier", `data-fam="${esc(fid)}"`)).join("")}</h4>`;
  if (famC.length) {
    fam += `<div class="people">` +
      famC.map(f => [f.h, f.w].filter(Boolean).map(x => chip(x, P.get(x)?.x === "F" ? "mère" : "père")).join("")).join("") + `</div>`;
  }
  if (nbParents < 2) fam += `<div class="ed-ligne">${ed("ajout-parent", "+ Ajouter un parent")}</div>`;
  fam += `<h4>Frères et sœurs${pleins.size + demis.size ? ` (${pleins.size + demis.size})` : ""}</h4>`;
  if (pleins.size || demis.size) {
    fam += `<div class="people">` +
      trierParNaissance([...pleins]).map(c => chip(c, libFratrie(c))).join("") +
      trierParNaissance([...demis]).map(c => chip(c, "demi-" + libFratrie(c))).join("") + `</div>`;
  }
  fam += `<div class="ed-ligne">${ed("ajout-fratrie", "+ Ajouter un frère ou une sœur")}</div>`;
  fam += `<h4>${famS.length > 1 ? "Unions" : "Union"}</h4>`;
  if (famS.length) {
    for (const { id: fid, f } of famS) {
      const conj = f.h === id ? f.w : f.h;
      const m = f.m, evs = f.e || [];
      const meta = [];
      if (m && (m.d || m.p)) meta.push(`Mariage${m.d ? " : " + esc(m.d) : ""}${m.p ? " — " + esc(m.p) : ""}`);
      else meta.push("Union");
      for (const e of evs) meta.push(`${esc(e.t)}${e.d ? " : " + esc(e.d) : ""}${e.p ? " — " + esc(e.p) : ""}${e.v ? " (" + esc(e.v) + ")" : ""}`);
      for (const n of [...(m?.n || []), ...(f.n || [])]) meta.push(esc(n));
      fam += `<div class="union"><div class="people">${conj && P.has(conj) ? chip(conj, P.get(conj).x === "F" ? "épouse / compagne" : "époux / compagnon") : '<span class="vide">Conjoint inconnu</span>'}</div>` +
        `<div class="meta">${meta.join("<br>")} ${ed("famille", "modifier l’union", `data-fam="${esc(fid)}"`)}</div>` +
        (f.c.length ? `<h4>Enfants (${f.c.length})</h4><div class="people">${trierParNaissance(f.c).map(c => chip(c, P.get(c)?.x === "F" ? "fille" : "fils")).join("")}</div>` : "") +
        `<div class="ed-ligne">${ed("ajout-enfant", "+ Ajouter un enfant", `data-fam="${esc(fid)}"`)}</div></div>`;
    }
  }
  fam += `<div class="ed-ligne">${ed("ajout-union", "+ Ajouter une union (conjoint)")}` +
    (famS.length ? "" : ed("ajout-enfant", "+ Ajouter un enfant (autre parent inconnu)")) + `</div>`;
  h += `<section class="card"><h3>Famille</h3>${fam}</section>`;

  // Ascendance
  h += `<section class="card"><h3>Ascendance et descendance<span class="sp pedinfo vide"></span></h3>` +
    `<div class="ped-legende"><span>‹ descendants</span><span>ancêtres ›</span></div>` +
    `<div class="pedwrap" id="ped" aria-label="Arbre d’ascendance et de descendance"></div></section>`;

  // Événements
  const evs = (p.e || []).filter(e => e.t !== "Inhumation" && e.t !== "Baptême");
  if (evs.length) h += `<section class="card"><h3>Événements et parcours</h3><div class="evs">${evs.map(ligneEvenement).join("")}</div></section>`;

  // Contexte historique
  const ctx = contexteHistorique(p);
  if (ctx.evenements.length || ctx.regnes.length) {
    h += `<section class="card"><h3>Dans l’Histoire${ctx.approx ? '<span class="sp">dates estimées</span>' : ""}</h3>` +
      (ctx.regnes.length ? `<p style="margin:0 0 10px"><span class="vide">Sous :</span> ${ctx.regnes.map(esc).join(" · ")}</p>` : "") +
      `<div class="evs">${ctx.evenements.map(e => `<div class="ev"><div class="d">${e.a === e.f ? e.a : e.a + "–" + e.f}</div><div>` +
        `<b>${esc(e.t)}</b><span class="tag">${e.s === "F" ? "France" : "Monde"}</span>` +
        `<small>${e.age ? esc(e.age) + " — " : ""}${esc(e.d)}</small></div></div>`).join("")}</div></section>`;
  }

  // Notes
  if (p.nt?.length) h += `<section class="card"><h3>Notes</h3>${p.nt.map(texteRepliable).join("")}</section>`;

  // Photos
  h += `<section class="card"><h3>Photos${p.ph?.length ? ` (${p.ph.length})` : ""}<span class="sp">${ed("photos", "+ Ajouter / gérer les photos")}</span></h3>` +
    (p.ph?.length ? `<div class="gal">` +
      p.ph.map(x => `<figure>${imgPhoto(x.u, x.t || nomTexte(p), `data-full="${esc(x.u)}"`)}` +
        `${x.t || x.d ? `<figcaption>${esc([x.t, x.d].filter(Boolean).join(" · "))}</figcaption>` : ""}</figure>`).join("") + `</div>` :
      '<p class="vide">Aucune photo.</p>') + `</section>`;

  // Coordonnées
  if (p.em?.length || p.ad?.length) {
    h += `<section class="card"><h3>Coordonnées</h3><dl class="facts">` +
      (p.em?.length ? `<dt>E-mail</dt><dd>${p.em.map(e => `<a href="mailto:${esc(e)}">${esc(e)}</a>`).join("<br>")}</dd>` : "") +
      (p.ad?.length ? `<dt>Adresse</dt><dd>${p.ad.map(esc).join("<br>")}</dd>` : "") + `</dl></section>`;
  }

  // Sources
  const sources = [...(p.s || []), ...famS.flatMap(x => x.f.s || [])];
  if (sources.length) {
    h += `<section class="card"><h3>Sources (${sources.length})</h3><ul class="src">` + sources.map(s => {
      const page = s.p ? (/^https?:\/\//.test(s.p) ? ` — <a href="${esc(s.p)}" target="_blank" rel="noopener noreferrer">consulter l’enregistrement</a>` : ` — ${esc(s.p)}`) : "";
      return `<li><b>${esc(s.t || "Source")}</b>${page}` +
        (s.x ? `<details><summary>Extrait</summary><pre>${esc(s.x)}</pre></details>` : "") + `</li>`;
    }).join("") + `</ul></section>`;
  }
  h += `</article>`;
  const garderDefilement = etat.derniereFiche === id;   // nouvel affichage de la même fiche après une modification
  const defilement = detailEl.scrollTop;
  detailEl.innerHTML = h;
  detailEl.scrollTop = garderDefilement ? defilement : 0;
  etat.derniereFiche = id;
  const ped = detailEl.querySelector("#ped");
  if (ped) monterAscendance(ped, id); else { pedObs?.disconnect(); pedObs = null; }
}

/* ---------- navigation ---------- */
function afficher(id, { depuisClic = false } = {}) {
  if (!P.has(id)) id = D.racine;
  etat.courant = id;
  fermerPeek();
  renderFiche(id);
  document.title = `${nomTexte(P.get(id))} — ${D.titre}`;
  const prec = listEl.querySelector('[aria-current="true"]');
  if (prec) prec.removeAttribute("aria-current");
  const ligne = listEl.querySelector(`[data-id="${id}"]`);
  if (ligne) { ligne.setAttribute("aria-current", "true"); ligne.scrollIntoView({ block: "nearest" }); }
  if (depuisClic) app.classList.add("view-detail");
}

let onglet = "personnes";
function montrerOnglet(nom) {
  onglet = nom;
  app.hidden = nom !== "personnes";
  $("#fresque").hidden = nom !== "fresque";
  $("#stpage").hidden = nom !== "stats";
  $("#tab-pers").setAttribute("aria-selected", String(nom === "personnes"));
  $("#tab-fr").setAttribute("aria-selected", String(nom === "fresque"));
  $("#tab-st").setAttribute("aria-selected", String(nom === "stats"));
  if (nom === "fresque") { document.title = `Fresque — ${D.titre}`; Fresque.montrer(); }
  else if (nom === "stats") { document.title = `Statistiques — ${D.titre}`; Stat.montrer(); }
}
function route() {
  if (!tousIds.length) return;          // données pas encore chargées
  const h = location.hash.slice(1);
  if (h.startsWith("fresque")) {
    const id = h.split(":")[1];
    montrerOnglet("fresque");
    Fresque.choisir(P.has(id) ? id : etat.courant, { centrer: true });
  } else if (h === "stats") {
    montrerOnglet("stats");
  } else {
    montrerOnglet("personnes");
    afficher(P.has(h) ? h : (etat.courant || D.racine), { depuisClic: P.has(h) });
  }
}
window.addEventListener("hashchange", route);
$("#tab-pers").addEventListener("click", () => { location.hash = "#" + (etat.courant || D.racine); route(); });
$("#tab-fr").addEventListener("click", () => { location.hash = "#fresque:" + (etat.courant || D.racine); route(); });
$("#tab-st").addEventListener("click", () => { location.hash = "#stats"; route(); });

let minuteur;
$("#q").addEventListener("input", e => { clearTimeout(minuteur); minuteur = setTimeout(() => { etat.q = e.target.value; renderListe(); }, 120); });
$("#tri").addEventListener("change", e => { etat.tri = e.target.value; store.set("tri", etat.tri); renderListe(); });
$("#chips").addEventListener("click", e => {
  const b = e.target.closest(".chip"); if (!b) return;
  const f = b.dataset.f, on = b.getAttribute("aria-pressed") !== "true";
  b.setAttribute("aria-pressed", on);
  if (on) { etat.filtres.add(f); if (f === "M") clearSex("F"); if (f === "F") clearSex("M"); } else etat.filtres.delete(f);
  renderListe();
});
function clearSex(f) { etat.filtres.delete(f); document.querySelector(`.chip[data-f="${f}"]`).setAttribute("aria-pressed", "false"); }
$("#home").addEventListener("click", () => { location.hash = D.racine; route(); });

detailEl.addEventListener("click", e => {
  const t = e.target;
  if (t.closest(".back")) { app.classList.remove("view-detail"); return; }
  const pn = t.closest(".pn");   // clic sur une personne de l'ascendance : aperçu à droite, sans quitter la fiche
  if (pn && !(e.ctrlKey || e.metaKey || e.shiftKey || e.button)) {
    e.preventDefault(); ouvrirPeek(pn.dataset.id, pn.dataset.gen !== undefined ? +pn.dataset.gen : undefined); return;
  }
  const deplier = t.closest(".pd-more, .pd-moins");
  if (deplier) { deplier.closest(".pedwrap")._etendre(deplier); return; }
  const more = t.closest(".more");
  if (more) { const n = more.previousElementSibling; n.classList.toggle("clamp"); more.textContent = n.classList.contains("clamp") ? "Tout afficher" : "Réduire"; return; }
  if (t.dataset?.full) ouvrirPhoto(t.dataset.full, t.alt);
  const ma = t.closest("[data-ma-fiche]");
  if (ma) { store.set("racine", ma.dataset.maFiche); D.racine = ma.dataset.maFiche; renderFiche(etat.courant); }
});
function ouvrirPhoto(chemin, legende) {
  const lb = $("#lb");
  lb.innerHTML = `${imgPhoto(chemin)}<p>${esc(legende)}</p>`;
  lb.classList.add("on");
}
$("#lb").addEventListener("click", () => $("#lb").classList.remove("on"));
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { if ($("#lb").classList.contains("on")) $("#lb").classList.remove("on"); else if (!peekEl.hidden) fermerPeek(); }
  else if (e.key === "/" && document.activeElement !== $("#q") && !/input|select|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); $("#q").focus(); }
});

/* ================= Repères historiques ================= */
const HIST = HISTOIRE;
const CATS = {
  G: ["Guerre", "#c0392b"], P: ["Politique", "#2f5d9f"], C: ["Culture et sciences", "#2f8f6b"],
  S: ["Société et économie", "#c98a1a"], E: ["Épidémie, catastrophe", "#7e57c2"], R: ["Religion", "#8a6d3b"],
};
const EVTS = HIST.evenements.map(([a, f, t, c, s, i, d]) => ({ a, f: f ?? a, periode: f != null && f > a, t, c, s, i, d }));
const plage = (a, f) => a === f ? `${a}` : `${a}–${f}`;

function contexteHistorique(p) {
  if (!p.fr) return { evenements: [], regnes: [], approx: false };
  const [, s, e, fl] = p.fr;
  const nes = (fl & 1) ? null : p.b?.y ?? null;
  const dans = x => x.a <= e && x.f >= s;
  const candidats = EVTS.filter(x => x.i <= 2 && dans(x));
  const majeurs = candidats.filter(x => x.i === 1);
  const autres = candidats.filter(x => x.i === 2).sort((a, b) => (a.s === "F" ? 0 : 1) - (b.s === "F" ? 0 : 1));
  const choisis = [...majeurs, ...autres.slice(0, Math.max(0, 14 - majeurs.length))].sort((a, b) => a.a - b.a);
  const evenements = choisis.map(x => {
    let age = "";
    if (nes !== null && !x.periode && x.a >= nes) age = `à ${x.a - nes} an${x.a - nes > 1 ? "s" : ""}`;
    else if (nes !== null && x.periode && x.a >= nes) age = `débute à ${x.a - nes} ans`;
    else if (nes !== null && x.periode) age = "déjà en cours à sa naissance";
    return { ...x, age };
  });
  const regnes = HIST.souverains.filter(([a, f]) => a <= e && f >= s).map(x => x[2]);
  return { evenements, regnes: [...new Set(regnes)].slice(0, 12), approx: !!(fl & 1) || (fl & 2 && !p.dt?.y) };
}

/* ================= Fresque (arbre complet sur l'axe du temps) ================= */
const Fresque = (function () {
  const wrap = $("#fr-wrap"), cv = $("#fr-cv"), ctx = cv.getContext("2d"), tip = $("#fr-tip"), panel = $("#fr-panel");
  const tMax = 2035;
  const COUL_DESC = "#e08a1e";   // descendants (orange) ; les ascendants utilisent la couleur d'accent
  // données dérivées de l'arbre, recalculées après chaque modification (charger)
  let PERS = [], tMin = 1500, PARENTS = new Map(), ENFANTS = new Map(), BASE_PE = [], BASE_U = [], sale = true;
  function charger() {
    sale = false;
    Modele.disposer(D.personnes, D.familles, D.racine);   // ligne de chaque personne (p.fr[0])
    PERS = D.personnes.filter(p => p.fr);
    for (const p of PERS) {
      const g = (p.g || "").trim().split(/\s+/)[0] || "";
      p._lab = inconnu(p) ? "?" : `${g} ${(p.n || "").toUpperCase()}`.trim();
    }
    tMin = Math.min(...PERS.map(p => p.fr[1])) - 20;
    // graphe de parenté complet : parent -> enfant (tracé à la naissance de l'enfant) et unions (à la date du mariage)
    PARENTS = new Map(PERS.map(p => [p.i, []])); ENFANTS = new Map(PERS.map(p => [p.i, []]));
    BASE_PE = []; BASE_U = [];
    for (const f of Object.values(F)) {
      const h = P.get(f.h), w = P.get(f.w);
      const enf = f.c.map(c => P.get(c)).filter(Boolean);
      for (const c of enf) for (const x of [h, w]) if (x) {
        BASE_PE.push({ c: c.i, x: x.i, sx: x.x, an: c.fr[1] });
        PARENTS.get(c.i).push(x.i); ENFANTS.get(x.i).push(c.i);
      }
      if (h && w) {
        const an = f.m?.y ?? (enf.length ? Math.min(...enf.map(c => c.fr[1])) - 1 : Math.max(h.fr[1], w.fr[1]) + 20);
        BASE_U.push({ a: h.i, b: w.i, an });
      }
    }
    if (S.sel && !P.has(S.sel)) S.sel = null;
    if (S.mode === "anc" && !P.has(S.ref)) { S.mode = "tout"; majOutils(); }
    recalculer();
  }

  // ensemble affiché (tout l'arbre, ou les ancêtres directs d'une personne) : lignes, liens, courbe des vivants
  let VIS = PERS, nbLignes = 1, parLigne = [], liensPE = [], liensU = [], linCache = null, maxVivants = 1;
  const vivants = new Uint16Array(tMax + 2);
  const GEN = new Map();   // mode « ancêtres » : génération de chaque personne (0 = la personne de référence)

  const etatF = {
    pret: false, W: 0, H: 0, dpr: 1, t0: 1500, k: 1.6, y0: 0, rowH: 18,
    montreF: true, montreM: true, liens: "tous", cats: new Set(Object.keys(CATS)),
    mode: "tout", ref: null, gen: 0,
    sel: null, selEv: null, survol: null, souris: null, glisse: null, hits: [], dessin: 0,
  };
  const S = etatF;
  function recalculer() {
    GEN.clear();
    if (S.mode === "anc" && P.has(S.ref)) {
      GEN.set(S.ref, 0);
      const q = [S.ref];
      for (let i = 0; i < q.length; i++) {
        const g = GEN.get(q[i]);
        if (S.gen && g >= S.gen) continue;
        for (const pp of PARENTS.get(q[i])) if (!GEN.has(pp)) { GEN.set(pp, g + 1); q.push(pp); }
      }
      VIS = PERS.filter(p => GEN.has(p.i));
    } else VIS = PERS;
    const vis = new Set(VIS.map(p => p.i));
    let num;   // identifiant -> ligne
    if (S.mode === "anc") num = disposerAncetres(vis);
    else {
      const rows = [...new Set(VIS.map(p => p.fr[0]))].sort((a, b) => a - b);
      const m = new Map(rows.map((r, i) => [r, i]));
      num = new Map(VIS.map(p => [p.i, m.get(p.fr[0])]));
    }
    nbLignes = Math.max(1, ...num.values()) + 1;
    parLigne = Array.from({ length: nbLignes }, () => []);
    for (const p of PERS) {
      p._v = vis.has(p.i); p._r = p._v ? num.get(p.i) : -1;
      if (p._v) parLigne[p._r].push(p);
    }
    liensPE = BASE_PE.filter(l => vis.has(l.c) && vis.has(l.x)).map(l => ({ ...l, r1: P.get(l.x)._r, r2: P.get(l.c)._r }));
    liensU = BASE_U.filter(l => vis.has(l.a) && vis.has(l.b)).map(l => ({ ...l, r1: P.get(l.a)._r, r2: P.get(l.b)._r }));
    vivants.fill(0);
    for (const p of VIS) for (let y = Math.max(0, p.fr[1]); y <= Math.min(tMax, p.fr[2]); y++) vivants[y]++;
    maxVivants = Math.max(1, ...vivants);
    linCache = null;
  }
  // Disposition « arbre d'ascendance » : à partir de la personne de référence, le père se place au-dessus et la mère
  // au-dessous de leur enfant ; une même ligne est réutilisée par des personnes d'époques différentes.
  function disposerAncetres(vis) {
    const memo = new Map();
    const ancetres = id => {
      if (memo.has(id)) return memo.get(id);
      memo.set(id, new Set());                       // garde-fou contre les cycles
      const s = new Set();
      for (const x of PARENTS.get(id)) if (vis.has(x)) { s.add(x); for (const y of ancetres(x)) s.add(y); }
      memo.set(id, s);
      return s;
    };
    const lignes = new Map(), rang = new Map(), MARGE = 1.5, COMPACTION = 0.5;
    const libre = (r, s, e) => (lignes.get(r) || []).every(([a, b]) => e + MARGE <= a || s - MARGE >= b);
    const placer = (id, souhait) => {
      const [, s, e] = P.get(id).fr, base = Math.round(souhait);
      for (let d = 0; ; d++) for (const r of d ? [base + d, base - d] : [base]) if (libre(r, s, e)) {
        if (!lignes.has(r)) lignes.set(r, []);
        lignes.get(r).push([s, e]); rang.set(id, r); return;
      }
    };
    placer(S.ref, 0);
    const file = [S.ref];
    for (let i = 0; i < file.length; i++) {
      const x = file[i], rx = rang.get(x), ps = PARENTS.get(x).filter(id => vis.has(id) && !rang.has(id));
      const pere = ps.find(id => P.get(id).x === "M") ?? ps.find(id => P.get(id).x !== "F");
      const mere = ps.find(id => id !== pere && P.get(id).x === "F") ?? ps.find(id => id !== pere);
      for (const [id, sens] of [[pere, -1], [mere, 1]]) {
        if (!id || rang.has(id)) continue;
        placer(id, rx + sens * (1 + COMPACTION * ancetres(id).size / 2));
        file.push(id);
      }
    }
    for (const id of vis) if (!rang.has(id)) placer(id, 0);   // sécurité
    const rows = [...new Set(rang.values())].sort((a, b) => a - b), m = new Map(rows.map((r, i) => [r, i]));
    return new Map([...rang].map(([id, r]) => [id, m.get(r)]));
  }
  // ascendants et descendants (toutes générations) d'une personne, pour mettre la lignée en évidence
  function lignee(id) {
    if (linCache && linCache.id === id) return linCache;
    const anc = new Set(), desc = new Set();
    let q = [id];
    for (let i = 0; i < q.length; i++) for (const x of PARENTS.get(q[i]) || []) if (x !== id && !anc.has(x)) { anc.add(x); q.push(x); }
    q = [id];
    for (let i = 0; i < q.length; i++) for (const x of ENFANTS.get(q[i]) || []) if (x !== id && !desc.has(x)) { desc.add(x); q.push(x); }
    return (linCache = { id, anc, desc, proches: null });
  }
  const G = 76;  // colonne d'étiquettes à gauche de la frise
  const X = an => G + (an - S.t0) * S.k;
  const AN = x => (x - G) / S.k + S.t0;
  const couleurs = {};
  const relire = () => {
    const cs = getComputedStyle(document.documentElement);
    for (const n of ["ink", "muted", "line", "panel", "bg", "accent", "hover"]) couleurs[n] = cs.getPropertyValue("--" + n).trim();
    couleurs.sombre = matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const COUL_SEXE = { M: "#3f78b5", F: "#bd4f74", U: "#7d827f" };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { relire(); demander(); });

  /* ----- mise en page de l'en-tête (frise) ----- */
  const LANE = 17, NLANES = 3, POLICE_EV = "11.5px system-ui, sans-serif";
  const seuil = () => S.k < 0.9 ? 1 : S.k < 2.6 ? 2 : 3;
  function evenementsVisibles() {
    const m = seuil();
    return EVTS.filter(e => e.i <= m && S.cats.has(e.c) && ((e.s === "F" && S.montreF) || (e.s === "M" && S.montreM)));
  }
  // répartit les libellés d'événements en couloirs (lignes) sans chevauchement
  const etroit = () => S.W < 640;   // téléphone : frise réduite pour laisser de la place à l'arbre
  function placerCouloirs(scope) {
    const fin = Array(etroit() ? 2 : NLANES).fill(-1e9), items = [];
    let n = 0;
    for (const e of evenementsVisibles().filter(e => e.s === scope).sort((a, b) => a.a - b.a || a.i - b.i)) {
      const x1 = X(e.a), x2 = X(e.f);
      if (x2 < G - 10 || x1 > S.W + 400) continue;
      const xt = Math.max(x1, G + 4), wt = largeur(e.t, POLICE_EV) + 14;
      const lane = fin.findIndex(v => v < xt - 4);
      if (lane < 0) continue;
      fin[lane] = xt + wt;
      n = Math.max(n, lane + 1);
      items.push({ e, lane, xt, wt, x1, x2 });
    }
    return { items, n: Math.max(n, 1) };
  }
  function entete() {
    let y = 0; const L = {};
    L.axe = [y, 26]; y += 26;
    L.epoques = [y, 18]; y += 20;
    if (S.montreF) { L.regimes = [y, 18]; y += 20; }
    if (S.montreF && !etroit()) { L.souverains = [y, 18]; y += 20; }
    if (S.montreF) { L.pF = placerCouloirs("F"); L.evF = [y, LANE * L.pF.n + 3]; y += LANE * L.pF.n + 6; }
    if (S.montreM) { L.pM = placerCouloirs("M"); L.evM = [y, LANE * L.pM.n + 3]; y += LANE * L.pM.n + 6; }
    const hh = etroit() ? 24 : 38;
    L.hist = [y, hh]; y += hh + 2;
    L.h = y;
    return L;
  }

  /* ----- dessin ----- */
  function demander() { if (!S.dessin) S.dessin = requestAnimationFrame(() => { S.dessin = 0; dessiner(); }); }
  const mesures = new Map();
  function largeur(t, police) {
    const k = police + t;
    let w = mesures.get(k);
    if (w === undefined) { ctx.font = police; w = ctx.measureText(t).width; mesures.set(k, w); }
    return w;
  }
  function tronquer(t, max, police) {
    if (largeur(t, police) <= max) return t;
    let a = 0, b = t.length;
    while (a < b) { const m = (a + b + 1) >> 1; if (largeur(t.slice(0, m) + "…", police) <= max) a = m; else b = m - 1; }
    return a > 1 ? t.slice(0, a) + "…" : "";
  }
  function etiquette(txt, y, h) {   // nom de la rangée, dans la colonne de gauche
    ctx.font = "600 9.5px system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.fillStyle = couleurs.muted;
    ctx.fillText(tronquer(txt, G - 12, ctx.font), 8, y + Math.min(h, 20) / 2 + .5);
  }

  function dessiner() {
    if (!S.pret || !S.W) return;
    if (!couleurs.ink) relire();
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.clearRect(0, 0, S.W, S.H);
    const L = entete();
    S.hits = [];
    corps(L);
    haut(L);
    ctx.strokeStyle = couleurs.line; ctx.beginPath(); ctx.moveTo(G - .5, L.h); ctx.lineTo(G - .5, S.H); ctx.stroke();
    miniature(L);
    croisillon(L);
  }

  function corps(L) {
    const { W, H, rowH } = S, hb = H - L.h;
    ctx.save();
    ctx.beginPath(); ctx.rect(G, L.h, W - G, hb); ctx.clip();
    ctx.translate(0, L.h - S.y0);
    const r0 = Math.max(0, Math.floor(S.y0 / rowH) - 1), r1 = Math.min(nbLignes - 1, Math.ceil((S.y0 + hb) / rowH) + 1);
    const yTop = S.y0, yBas = S.y0 + hb;

    // bandes des régimes (alternées) + limites
    HIST.regimes.forEach(([a, f], i) => {
      const x1 = X(a), x2 = X(f);
      if (x2 < G || x1 > W) return;
      if (i % 2) { ctx.fillStyle = couleurs.sombre ? "rgba(255,255,255,.035)" : "rgba(0,0,0,.03)"; ctx.fillRect(x1, yTop, x2 - x1, hb); }
    });
    // grille
    const pas = pasAxe();
    ctx.strokeStyle = couleurs.line; ctx.lineWidth = 1; ctx.beginPath();
    for (let a = Math.ceil(AN(G) / pas) * pas; X(a) < W; a += pas) { const x = Math.round(X(a)) + .5; ctx.moveTo(x, yTop); ctx.lineTo(x, yBas); }
    ctx.globalAlpha = .55; ctx.stroke(); ctx.globalAlpha = 1;

    // événements : traits (majeurs) et bandes (périodes)
    const evs = evenementsVisibles();
    for (const e of evs) {
      const x1 = X(e.a), x2 = X(e.f), col = CATS[e.c][1], choisi = e === S.selEv || e === S.survolEv;
      if (e.i > 1 && !choisi) continue;   // en arrière-plan : seulement les repères majeurs
      if (e.periode && x2 >= G && x1 <= W) {
        ctx.fillStyle = col; ctx.globalAlpha = choisi ? .16 : .045; ctx.fillRect(x1, yTop, x2 - x1, hb); ctx.globalAlpha = 1;
      } else if (!e.periode && x1 >= G && x1 <= W && (choisi || S.k >= 1)) {
        ctx.strokeStyle = col; ctx.globalAlpha = choisi ? .9 : .26; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(Math.round(x1) + .5, yTop); ctx.lineTo(Math.round(x1) + .5, yBas); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    }
    const psel = S.sel && P.get(S.sel)._v ? P.get(S.sel) : null;
    if (psel) {  // vie de la personne choisie
      const x1 = X(psel.fr[1]), x2 = X(psel.fr[2]);
      ctx.fillStyle = couleurs.accent; ctx.globalAlpha = .09; ctx.fillRect(x1, yTop, x2 - x1, hb); ctx.globalAlpha = 1;
      ctx.fillStyle = couleurs.accent; ctx.globalAlpha = .1; ctx.fillRect(G, psel._r * rowH, W - G, rowH); ctx.globalAlpha = 1;
    }
    // lignée mise en évidence : la personne choisie, sinon celle que la souris survole
    const foc = psel ? psel.i : (S.survol && P.get(S.survol)._v ? S.survol : null);
    const lin = foc ? lignee(foc) : null;
    if (lin && !lin.proches) lin.proches = relatifs(P.get(foc));
    const proches = lin ? lin.proches : null;

    // barres
    const h = rowH - 5, police = `${Math.min(12, Math.max(9, rowH - 7))}px system-ui, sans-serif`;
    const evAnnee = S.selEv;
    for (let r = r0; r <= r1; r++) {
      for (const p of parLigne[r]) {
        const [, s, e, fl] = p.fr;
        const x1 = X(s), x2 = X(e);
        if (x2 < G || x1 > W) continue;
        const y = r * rowH + 2.5, w = Math.max(x2 - x1, 4);
        const estD = fl & 1, estF = fl & 2;
        let dim = 1, anneau = null;
        if (evAnnee) dim = (s <= evAnnee.f && e >= evAnnee.a) ? 1 : .22;
        else if (lin && p.i !== foc) {
          if (lin.anc.has(p.i)) anneau = couleurs.accent;
          else if (lin.desc.has(p.i)) anneau = COUL_DESC;
          else dim = proches.has(p.i) ? .6 : .2;
        }
        const col = COUL_SEXE[p.x] || COUL_SEXE.U;
        ctx.globalAlpha = dim;
        if (estD && estF) { ctx.fillStyle = col; ctx.globalAlpha = dim * .28; rr(x1, y, w, h, 3); ctx.fill(); ctx.globalAlpha = dim; }
        else if (estF || estD) {
          const g = ctx.createLinearGradient(x1, 0, x1 + w, 0);
          if (estF) { g.addColorStop(0, col); g.addColorStop(Math.min(.5, 24 / w), col); g.addColorStop(1, col + "26"); }
          else { g.addColorStop(0, col + "26"); g.addColorStop(Math.max(.5, 1 - 24 / w), col); g.addColorStop(1, col); }
          ctx.fillStyle = g; rr(x1, y, w, h, 3); ctx.fill();
        } else { ctx.fillStyle = col; rr(x1, y, w, h, 3); ctx.fill(); }
        if (p.i === S.sel || p.i === S.survol) {
          ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.strokeStyle = couleurs.ink; rr(x1 - 1, y - 1, w + 2, h + 2, 4); ctx.stroke(); ctx.lineWidth = 1;
        } else if (anneau) {
          ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.strokeStyle = anneau; rr(x1 - 1, y - 1, w + 2, h + 2, 4); ctx.stroke(); ctx.lineWidth = 1;
        }
        // libellé
        if (w > 34 && rowH >= 14) {
          const xd = Math.max(x1, G) + 4, dispo = Math.min(x2, W) - xd - 4;  // partie visible de la barre
          const t = tronquer(p._lab, dispo, police);
          if (t) {
            ctx.globalAlpha = dim * (estD && estF ? .8 : 1);
            ctx.font = police; ctx.textBaseline = "middle";
            ctx.fillStyle = estD && estF ? couleurs.ink : "#fff";
            ctx.fillText(t, xd, y + h / 2 + .5);
          }
        }
        ctx.globalAlpha = 1;
      }
    }
    if (S.liens !== "aucun") tracerLiens(r0, r1, foc, lin);
    ctx.restore();
  }
  // liens de parenté, tracés au-dessus des barres : père (bleu) et mère (rose) rejoignent l'enfant à sa naissance ;
  // avec une personne en évidence, sa lignée est épaisse : ascendance en vert, descendance en orange
  function tracerLiens(r0, r1, foc, lin) {
    const { W, rowH } = S;
    const trait = (xx, y1, y2, col, larg, alpha, halo) => {
      if (halo) { ctx.strokeStyle = couleurs.panel; ctx.globalAlpha = halo; ctx.lineWidth = larg + 3; ctx.beginPath(); ctx.moveTo(xx, y1); ctx.lineTo(xx, y2); ctx.stroke(); }
      ctx.strokeStyle = col; ctx.globalAlpha = alpha; ctx.lineWidth = larg;
      ctx.beginPath(); ctx.moveTo(xx, y1); ctx.lineTo(xx, y2); ctx.stroke();
      ctx.fillStyle = col; const r = larg > 2 ? 3.4 : 2.3;
      ctx.beginPath(); ctx.arc(xx, y1, r, 0, 6.29); ctx.arc(xx, y2, r, 0, 6.29); ctx.fill();
    };
    // paliers (du plus discret au plus marqué) : 0 hors lignée · 1 lignée (ascendants ou descendants) · 2 lien direct
    // avec la personne en évidence ; -1 = aucune personne en évidence
    for (const pal of lin ? [0, 1, 2] : [-1]) {
      for (const l of liensPE) {
        if (Math.max(l.r1, l.r2) < r0 || Math.min(l.r1, l.r2) > r1) continue;
        const x = X(l.an); if (x < G - 2 || x > W + 2) continue;
        let t = -1;
        if (lin) {
          const dansLignee = ((l.c === foc || lin.anc.has(l.c)) && lin.anc.has(l.x)) || ((l.x === foc || lin.desc.has(l.x)) && lin.desc.has(l.c));
          t = (l.c === foc || l.x === foc) ? 2 : dansLignee ? 1 : 0;
        }
        if (t !== pal || (t === 0 && S.liens === "lignee")) continue;
        const xx = Math.round(x) + .5, y1 = l.r1 * rowH + rowH / 2, y2 = l.r2 * rowH + rowH / 2;
        const col = COUL_SEXE[l.sx] || COUL_SEXE.U;
        if (t === 2) trait(xx, y1, y2, col, 3.4, 1, .9);
        else if (t === 1) trait(xx, y1, y2, col, 2, .9, .7);
        else if (t === 0) trait(xx, y1, y2, col, 1.2, .08, 0);
        else trait(xx, y1, y2, col, 1.6, .8, .55);
      }
    }
    ctx.setLineDash([3, 3]);
    for (const l of liensU) {
      if (Math.max(l.r1, l.r2) < r0 || Math.min(l.r1, l.r2) > r1) continue;
      const x = X(l.an); if (x < G - 2 || x > W + 2) continue;
      const fort = lin && (l.a === foc || l.b === foc);
      if (lin && !fort && S.liens === "lignee") continue;
      const xx = Math.round(x) + .5, y1 = l.r1 * rowH + rowH / 2, y2 = l.r2 * rowH + rowH / 2;
      ctx.strokeStyle = "#d18a10"; ctx.globalAlpha = fort ? 1 : lin ? .1 : .7; ctx.lineWidth = fort ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(xx, y1); ctx.lineTo(xx, y2); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function relatifs(p) {
    const s = new Set([p.i]);
    for (const l of liensPE) { if (l.c === p.i) s.add(l.x); if (l.x === p.i) s.add(l.c); }
    for (const l of liensU) { if (l.a === p.i) s.add(l.b); if (l.b === p.i) s.add(l.a); }
    return s;
  }
  function pasAxe() {
    for (const p of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) if (p * S.k >= 64) return p;
    return 500;
  }
  function haut(L) {
    const { W } = S;
    ctx.save();
    ctx.fillStyle = couleurs.panel; ctx.fillRect(0, 0, W, L.h);
    // axe
    const pas = pasAxe();
    ctx.font = "11px system-ui, sans-serif"; ctx.textBaseline = "middle";
    ctx.strokeStyle = couleurs.line; ctx.fillStyle = couleurs.muted;
    ctx.beginPath();
    for (let a = Math.ceil(AN(-30) / pas) * pas; X(a) < W + 30; a += pas) {
      const x = Math.round(X(a)) + .5;
      ctx.moveTo(x, L.axe[0] + 16); ctx.lineTo(x, L.axe[0] + 26);
      const t = String(a); ctx.fillText(t, x - largeur(t, ctx.font) / 2, L.axe[0] + 9);
    }
    ctx.stroke();

    const bande = (cle, liste, palette, police, hit) => {
      if (!L[cle]) return;
      const [y, h] = L[cle];
      liste.forEach(([a, f, nom], i) => {
        const x1 = X(a), x2 = X(f);
        if (x2 < G || x1 > W) return;
        const cx1 = Math.max(x1, G), cx2 = Math.min(x2, W);
        ctx.fillStyle = palette[i % palette.length]; ctx.globalAlpha = couleurs.sombre ? .5 : .32;
        ctx.fillRect(cx1 + .5, y, cx2 - cx1 - 1, h); ctx.globalAlpha = 1;
        const t = tronquer(nom, cx2 - cx1 - 8, police);
        if (t) { ctx.font = police; ctx.fillStyle = couleurs.ink; ctx.textBaseline = "middle"; ctx.fillText(t, cx1 + 4, y + h / 2 + .5); }
        S.hits.push({ x1: cx1, x2: cx2, y1: y, y2: y + h, kind: "periode", a, f, nom, cle });
      });
    };
    const pal = ["#2f5d9f", "#c98a1a", "#2f8f6b", "#c0392b", "#7e57c2", "#8a6d3b"];
    const pal2 = ["#2f8f6b", "#2f5d9f", "#c98a1a"];
    bande("epoques", HIST.epoques, pal, "600 11px system-ui, sans-serif");
    bande("regimes", HIST.regimes, pal, "11px system-ui, sans-serif");
    bande("souverains", HIST.souverains, pal2, "10.5px system-ui, sans-serif");

    // événements (couloirs) : un point (ou un trait pour une période) + son libellé
    const couloirs = (cle, placement) => {
      if (!L[cle]) return;
      const [y0] = L[cle];
      for (const { e, lane, xt, wt, x1, x2 } of placement.items) {
        const y = y0 + 2 + lane * LANE, col = CATS[e.c][1], actif = e === S.selEv || e === S.survolEv;
        if (e.periode) {
          const a = Math.max(x1, G), b = Math.min(x2, W);
          ctx.fillStyle = col; ctx.globalAlpha = .6; ctx.fillRect(a, y + 13.5, Math.max(b - a, 2), 2.5); ctx.globalAlpha = 1;
        }
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(Math.max(x1, G + 4), y + 7, actif ? 4.6 : 3.6, 0, 6.29); ctx.fill();
        const police = actif ? "600 " + POLICE_EV : POLICE_EV;
        ctx.font = police; ctx.textBaseline = "middle";
        ctx.fillStyle = actif ? couleurs.accent : couleurs.ink;
        ctx.fillText(e.t, xt + 9, y + 7.5);
        S.hits.push({ x1: xt - 5, x2: xt + wt, y1: y, y2: y + LANE - 2, kind: "evt", e });
      }
    };
    if (L.pF) couloirs("evF", L.pF);
    if (L.pM) couloirs("evM", L.pM);

    // vivants
    const [yh, hh] = L.hist;
    ctx.fillStyle = couleurs.accent; ctx.globalAlpha = .35; ctx.beginPath(); ctx.moveTo(G, yh + hh);
    for (let x = G; x <= W; x += 2) {
      const a = Math.round(AN(x)); const c = a < 0 || a > tMax ? 0 : vivants[a];
      ctx.lineTo(x, yh + hh - (c / maxVivants) * (hh - 6));
    }
    ctx.lineTo(W, yh + hh); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    S.hits.push({ x1: G, x2: W, y1: yh, y2: yh + hh, kind: "hist" });

    // colonne d'étiquettes (masque aussi tout ce qui déborde à gauche)
    ctx.fillStyle = couleurs.panel; ctx.fillRect(0, 0, G, L.h);
    ctx.strokeStyle = couleurs.line; ctx.beginPath(); ctx.moveTo(G - .5, 0); ctx.lineTo(G - .5, L.h); ctx.stroke();
    if (L.epoques) etiquette("ÉPOQUE", L.epoques[0], 18);
    if (L.regimes) etiquette("RÉGIME", L.regimes[0], 18);
    if (L.souverains) etiquette("CHEF D’ÉTAT", L.souverains[0], 18);
    if (L.evF) etiquette("FRANCE", L.evF[0], LANE);
    if (L.evM) etiquette("MONDE", L.evM[0], LANE);
    etiquette("VIVANTS", L.hist[0], 20);
    ctx.font = "600 9.5px system-ui, sans-serif"; ctx.fillStyle = couleurs.muted; ctx.textBaseline = "alphabetic";
    if (L.hist[1] >= 34) ctx.fillText(`max ${maxVivants}`, 8, L.hist[0] + L.hist[1] - 6);
    ctx.strokeStyle = couleurs.line; ctx.beginPath(); ctx.moveTo(0, L.h - .5); ctx.lineTo(W, L.h - .5); ctx.stroke();
    ctx.restore();
  }
  // mini-carte de l'arbre entier (colonne de gauche) : clic ou glisser pour se déplacer verticalement
  const zoneMini = L => ({ x: 8, y: L.h + 10, w: G - 16, h: Math.max(20, S.H - L.h - 20) });
  function miniature(L) {
    const m = zoneMini(L), hb = S.H - L.h;
    ctx.save();
    ctx.fillStyle = couleurs.bg; ctx.fillRect(m.x - 2, m.y - 2, m.w + 4, m.h + 4);
    const dy = m.h / nbLignes, ht = Math.max(1, dy - .2), t1 = Math.max(tMin, 1000), sp = tMax - t1;
    const ev = S.selEv;
    for (const p of VIS) {
      const r = p._r, [, s, e] = p.fr;
      const a = Math.max(s, t1), b = Math.max(e, t1 + 8);
      ctx.fillStyle = COUL_SEXE[p.x] || COUL_SEXE.U;
      ctx.globalAlpha = p.i === S.sel ? 1 : ev ? (s <= ev.f && e >= ev.a ? 1 : .12) : .75;
      ctx.fillRect(m.x + (a - t1) / sp * m.w, m.y + r * dy, Math.max(1.2, (b - a) / sp * m.w), ht);
    }
    ctx.globalAlpha = 1;
    const total = nbLignes * S.rowH;
    const vy = m.y + S.y0 / total * m.h, vh = Math.min(m.h, hb / total * m.h);
    ctx.fillStyle = couleurs.accent; ctx.globalAlpha = .16; ctx.fillRect(m.x - 2, vy, m.w + 4, Math.max(vh, 3)); ctx.globalAlpha = 1;
    ctx.strokeStyle = couleurs.accent; ctx.lineWidth = 1.5; ctx.strokeRect(m.x - 2, vy, m.w + 4, Math.max(vh, 3));
    ctx.restore();
  }
  function saut(my) {
    const L = entete(), m = zoneMini(L), hb = S.H - L.h;
    S.y0 = (my - m.y) / m.h * nbLignes * S.rowH - hb / 2;
    limiter(); demander();
  }
  function croisillon(L) {
    if (!S.souris) return;
    const { x, y } = S.souris;
    if (y < 0 || y > S.H || x < G || x > S.W) return;
    ctx.save();
    ctx.strokeStyle = couleurs.ink; ctx.globalAlpha = .35; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, L.axe[0] + 14); ctx.lineTo(Math.round(x) + .5, S.H); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    const a = Math.round(AN(x)), t = String(a);
    ctx.font = "600 11px system-ui, sans-serif"; const w = ctx.measureText(t).width + 10;
    const px = Math.min(Math.max(x - w / 2, 0), S.W - w);
    ctx.fillStyle = couleurs.ink; rr(px, 2, w, 18, 5); ctx.fill();
    ctx.fillStyle = couleurs.panel; ctx.textBaseline = "middle"; ctx.fillText(t, px + 5, 11.5);
    ctx.restore();
  }

  /* ----- interaction ----- */
  function limiter() {
    const L = entete(), hb = S.H - L.h;
    const maxY = Math.max(0, nbLignes * S.rowH - hb + 30);
    S.y0 = Math.min(Math.max(S.y0, 0), maxY);
    const span = (S.W - G) / S.k;
    S.t0 = Math.min(Math.max(S.t0, tMin - span * .3), tMax - span * .7);
  }
  function zoomer(f, cx = G + (S.W - G) / 2) {
    const a = AN(cx);
    S.k = Math.min(Math.max(S.k * f, 0.12), 60);
    S.t0 = a - (cx - G) / S.k;
    limiter(); demander();
  }
  function afficherPlage(a, b) {
    S.k = Math.max(0.12, (S.W - G - 40) / (b - a)); S.t0 = a - 20 / S.k; limiter(); demander();
  }
  function preset(v) {
    if (v === "vie") {
      const p = P.get(S.sel || etat.courant);
      if (p) { const [, s, e] = p.fr; afficherPlage(s - 15, Math.max(e + 15, s + 40)); }
    } else if (v === "tout") afficherPlage(tMin, tMax);
    else afficherPlage(+v, tMax);
  }
  function centrerSur(id, forcerZoom = true, horizontal = true) {
    const p = P.get(id); if (!p) return;
    const L = entete(), hb = S.H - L.h;
    if (forcerZoom && S.k < 1.2) S.k = 2.2;
    if (!p._v) return;
    const r = p._r, [, s, e] = p.fr;
    if (horizontal) S.t0 = (s + e) / 2 - (S.W - G) / 2 / S.k;
    S.y0 = r * S.rowH + S.rowH / 2 - hb / 2;
    limiter(); demander();
  }

  function trouver(mx, my) {
    const L = entete();
    if (my < L.h) {
      for (let i = S.hits.length - 1; i >= 0; i--) {
        const h = S.hits[i];
        if (mx >= h.x1 && mx <= h.x2 && my >= h.y1 && my <= h.y2) return h;
      }
      return null;
    }
    if (mx < G) return null;
    const r = Math.floor((my - L.h + S.y0) / S.rowH);
    if (r < 0 || r >= nbLignes) return null;
    const an = AN(mx), marge = 3 / S.k;
    let best = null, bd = 1e9;
    for (const p of parLigne[r]) {
      const [, s, e] = p.fr;
      if (an >= s - marge && an <= e + Math.max(marge, 0)) {
        const d = Math.abs(an - (s + e) / 2);
        if (d < bd) { bd = d; best = p; }
      }
    }
    return best ? { kind: "pers", p: best } : null;
  }

  function libGen(g, sx) {
    if (g === 0) return "personne de référence";
    const f = sx === "F";
    const noms = ["", f ? "mère" : "père", f ? "grand-mère" : "grand-père", f ? "arrière-grand-mère" : "arrière-grand-père",
      f ? "trisaïeule" : "trisaïeul", f ? "quadrisaïeule" : "quadrisaïeul"];
    return `génération −${g} · ${g < noms.length ? noms[g] : "ancêtre"}`;
  }
  function infoBulle(h, mx, my) {
    if (!h) { tip.hidden = true; return; }
    let html = "";
    if (h.kind === "pers") {
      const p = h.p, [, s, e, fl] = p.fr;
      html = `<b>${esc(nomTexte(p))}</b>${esc(vie(p) || "dates inconnues")}` +
        `${(fl & 1) ? "<small><br>naissance estimée vers " + s + "</small>" : ""}${p.b?.p ? "<small><br>né(e) à " + esc(ville(p.b.p)) + "</small>" : ""}` +
        `${S.mode === "anc" && GEN.has(p.i) ? "<small><br>" + esc(libGen(GEN.get(p.i), p.x)) + "</small>" : ""}`;
    } else if (h.kind === "evt") {
      const e = h.e;
      html = `<b>${esc(e.t)}</b>${plage(e.a, e.f)} · ${esc(CATS[e.c][0])}<small><br>${esc(e.d)}</small>`;
    } else if (h.kind === "periode") {
      html = `<b>${esc(h.nom)}</b>${plage(h.a, Math.min(h.f, 2026))}`;
    } else if (h.kind === "hist") {
      const a = Math.round(AN(mx)); html = `<b>${a}</b>${a >= 0 && a <= tMax ? vivants[a] : 0} personnes de l’arbre vivantes`;
    }
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    tip.style.left = Math.min(mx + 14, S.W - w - 6) + "px";
    tip.style.top = (my + 18 + hgt > S.H ? my - hgt - 10 : my + 18) + "px";
  }

  const ptrs = new Map();
  let dist0 = 0;
  cv.addEventListener("pointerdown", e => {
    try { cv.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ }
    const r0 = cv.getBoundingClientRect(), mx0 = e.clientX - r0.left, my0 = e.clientY - r0.top, L0 = entete();
    if (mx0 < G && my0 > L0.h) { S.mini = true; saut(my0); return; }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) S.glisse = { x: e.clientX, y: e.clientY, t0: S.t0, y0: S.y0, bouge: false };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; dist0 = Math.hypot(a.x - b.x, a.y - b.y); S.glisse = null; }
  });
  cv.addEventListener("pointermove", e => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (S.mini) { saut(my); return; }
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist0 > 0) zoomer(d / dist0, (a.x + b.x) / 2 - r.left);
      dist0 = d; return;
    }
    const g = S.glisse;
    if (g) {
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) g.bouge = true;
      if (g.bouge) {
        cv.classList.add("drag");
        S.t0 = g.t0 - dx / S.k; S.y0 = g.y0 - dy; limiter(); tip.hidden = true; demander();
        return;
      }
    }
    S.souris = { x: mx, y: my };
    const h = trouver(mx, my);
    const id = h?.kind === "pers" ? h.p.i : null, ev = h?.kind === "evt" ? h.e : null;
    if (id !== S.survol || ev !== S.survolEv) { S.survol = id; S.survolEv = ev; }
    cv.style.cursor = h && h.kind !== "hist" ? "pointer" : "";
    infoBulle(h, mx, my); demander();
  });
  const fin = e => {
    if (S.mini) { S.mini = false; return; }
    ptrs.delete(e.pointerId);
    const g = S.glisse; S.glisse = null; cv.classList.remove("drag");
    if (g && !g.bouge && e.type === "pointerup") {
      const r = cv.getBoundingClientRect();
      cliquer(trouver(e.clientX - r.left, e.clientY - r.top));
    }
  };
  cv.addEventListener("pointerup", fin);
  cv.addEventListener("pointercancel", fin);
  cv.addEventListener("pointerleave", () => { S.souris = null; S.survol = null; tip.hidden = true; demander(); });
  cv.addEventListener("wheel", e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomer(Math.exp(-e.deltaY * .0025), e.clientX - r.left);
    else if (e.shiftKey) { S.t0 += (e.deltaY || e.deltaX) / S.k; limiter(); demander(); }
    else { S.y0 += e.deltaY; S.t0 += e.deltaX / S.k; limiter(); demander(); }
  }, { passive: false });
  cv.addEventListener("dblclick", e => { const r = cv.getBoundingClientRect(); zoomer(e.shiftKey ? .5 : 2, e.clientX - r.left); });

  function cliquer(h) {
    if (!h) { S.sel = null; S.selEv = null; panneau(); history.replaceState(null, "", "#fresque"); demander(); return; }
    if (h.kind === "pers") choisir(h.p.i, { centrer: false });
    else if (h.kind === "evt") { S.selEv = S.selEv === h.e ? null : h.e; S.sel = null; panneau(); voirVivants(); demander(); }
    else if (h.kind === "periode") {
      const e = { a: h.a, f: Math.min(h.f, 2026), periode: true, t: h.nom, c: "P", s: "F", i: 1, d: h.cle === "epoques" ? "Époque" : h.cle === "regimes" ? "Régime politique en France" : "Chef de l’État", persoPeriode: true };
      S.selEv = e; S.sel = null; panneau(); voirVivants(); demander();
    }
  }
  // fait défiler vers les lignes où se trouvent les personnes vivantes lors du repère choisi
  function voirVivants() {
    const e = S.selEv; if (!e) return;
    const rows = vivantsPendant(e.a, e.f).map(p => p._r).sort((a, b) => a - b);
    if (!rows.length) return;
    const L = entete(), hb = S.H - L.h, med = rows[rows.length >> 1];
    const visibles = rows.filter(r => r * S.rowH >= S.y0 && r * S.rowH <= S.y0 + hb).length;
    if (visibles < Math.min(3, rows.length)) { S.y0 = med * S.rowH - hb / 2; limiter(); }
  }

  /* ----- panneau latéral ----- */
  function vivantsPendant(a, f) {
    return VIS.filter(p => p.fr[1] <= f && p.fr[2] >= a);
  }
  function panneau() {
    let h = "";
    if (S.sel) {
      const p = P.get(S.sel), c = contexteHistorique(p);
      const fams = (p.fs || []).map(x => F[x]).filter(Boolean);
      const famC = (p.fc || []).map(x => F[x]).filter(Boolean);
      const par = famC.flatMap(f => [f.h, f.w]).filter(Boolean);
      const conj = fams.map(f => f.h === p.i ? f.w : f.h).filter(Boolean);
      const enf = [...new Set(fams.flatMap(f => f.c))];
      h += `<div class="hd" style="gap:12px;margin-bottom:6px">${avatar(p)}<div><h3>${nomHtml(p)}</h3><div class="sub">${esc(vie(p) || "dates inconnues")}` +
        `${p.fr[3] & 1 ? " · naissance estimée" : ""}${p.dt?.a ? " · à " + esc(p.dt.a) : ""}</div></div></div>`;
      const lieux = [p.b?.p && "Né(e) : " + ville(p.b.p), p.dt?.p && "Décès : " + ville(p.dt.p)].filter(Boolean);
      if (lieux.length) h += `<p class="sub">${lieux.map(esc).join(" · ")}</p>`;
      if (c.regnes.length) h += `<p class="sub">Sous : ${c.regnes.map(esc).join(" · ")}</p>`;
      const lin = lignee(p.i);
      h += `<p class="sub"><span class="cat-dot" style="background:${couleurs.accent}"></span>${lin.anc.size} ancêtre${lin.anc.size > 1 ? "s" : ""} connu${lin.anc.size > 1 ? "s" : ""}` +
        ` &nbsp;<span class="cat-dot" style="background:${COUL_DESC}"></span>${lin.desc.size} descendant${lin.desc.size > 1 ? "s" : ""}` +
        `${S.mode === "anc" && GEN.has(p.i) ? "<br>" + esc(libGen(GEN.get(p.i), p.x)) : ""}</p>`;
      h += `<div class="actions"><a class="btn" href="#${p.i}" style="text-decoration:none">Ouvrir la fiche</a>` +
        `<button class="btn" data-act="centrer">Centrer</button><button class="btn" data-act="vie">Cadrer sa vie</button>` +
        `${lin.anc.size ? '<button class="btn" data-act="anc">Ses ancêtres directs</button>' : ""}</div>`;
      const vi = i => P.get(i)?._v;
      const bloc = (t, ids, extra) => ids.length ? `<h4>${t(ids.length)}</h4><div class="people">${ids.map(i => chip(i, extra(i), "#fresque:")).join("")}</div>` : "";
      h += bloc(() => "Parents", par.filter(vi), i => P.get(i)?.x === "F" ? "mère" : "père");
      h += bloc(() => conj.length > 1 ? "Unions" : "Union", conj.filter(vi), () => "");
      h += bloc(n => `Enfants (${n})`, trierParNaissance(enf).filter(vi), i => P.get(i)?.x === "F" ? "fille" : "fils");
      if (c.evenements.length) {
        h += `<h4>Dans l’Histoire</h4><div class="evs">` + c.evenements.slice(0, 10).map(e =>
          `<div class="ev"><div class="d">${plage(e.a, e.f)}</div><div><b>${esc(e.t)}</b><small>${e.age ? esc(e.age) : ""}</small></div></div>`).join("") + `</div>`;
      }
    } else if (S.selEv) {
      const e = S.selEv, an = e.periode ? [e.a, e.f] : [e.a, e.a];
      const v = vivantsPendant(an[0], an[1]);
      const nH = v.filter(p => p.x === "M").length, nF = v.filter(p => p.x === "F").length;
      h += `<h3>${esc(e.t)}</h3><div class="sub">${e.persoPeriode ? "" : `<span class="cat-dot" style="background:${CATS[e.c][1]}"></span>${esc(CATS[e.c][0])} · ${e.s === "F" ? "France" : "Monde"} · `}${plage(e.a, e.f)}</div>`;
      if (e.d) h += `<p>${esc(e.d)}</p>`;
      h += `<h4>Dans l’arbre à cette époque</h4><p>${v.length} personne${v.length > 1 ? "s" : ""} ${e.periode ? "ont vécu pendant cette période" : "étaient en vie"}` +
        ` (${nH} homme${nH > 1 ? "s" : ""}, ${nF} femme${nF > 1 ? "s" : ""}). Les autres barres sont estompées.</p>`;
      const liste = v.slice().sort((a, b) => Math.abs((a.fr[1] + a.fr[2]) / 2 - (e.a + e.f) / 2) - Math.abs((b.fr[1] + b.fr[2]) / 2 - (e.a + e.f) / 2)).slice(0, 40);
      h += `<div class="people">${liste.map(p => chip(p.i, "", "#fresque:")).join("")}</div>`;
      if (v.length > liste.length) h += `<p class="sub">… et ${v.length - liste.length} autres.</p>`;
      h += `<div class="actions"><button class="btn" data-act="cadrer">Cadrer cette période</button></div>`;
    } else {
      h += `<h3>Fresque</h3><p class="sub">Chaque barre est une personne, de sa naissance à son décès. Un trait <b style="color:${COUL_SEXE.M}">bleu</b> relie un père, un trait <b style="color:${COUL_SEXE.F}">rose</b> une mère, à leur enfant, à sa naissance ; les traits orange pointillés relient les couples.</p>` +
        `<p class="sub">Passez la souris sur une personne (ou cliquez dessus) : sa lignée s’allume — <b style="color:${couleurs.accent}">ascendance en vert</b>, <b style="color:${COUL_DESC}">descendance en orange</b>. Pour ne garder que les ancêtres directs, utilisez « Ancêtres directs seulement » en haut.</p>` +
        `<p class="sub">Les barres <b>estompées</b> ont des dates estimées (à partir des parents, enfants, conjoints). En haut : les époques, les régimes et chefs d’État de la France, puis les grands événements en France et dans le monde.</p>` +
        `<p class="sub">Cliquez sur une <b>personne</b> pour voir sa famille, ou sur un <b>repère historique</b> pour voir qui était en vie.</p>`;
    }
    panel.innerHTML = h; panel.scrollTop = 0;
  }
  panel.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "centrer") centrerSur(S.sel);
    else if (b.dataset.act === "vie") { $("#fr-plage").value = "vie"; preset("vie"); centrerSur(S.sel, false); }
    else if (b.dataset.act === "anc") definirMode("anc", S.sel);
    else if (b.dataset.act === "cadrer" && S.selEv) { afficherPlage(S.selEv.a - 10, Math.max(S.selEv.f, S.selEv.a + 30) + 10); }
  });

  function choisir(id, { centrer = true } = {}) {
    if (!P.has(id) || !P.get(id).fr) return;
    if (!P.get(id)._v) definirMode("tout");   // personne hors des ancêtres affichés : on revient à l'arbre complet
    S.sel = id; S.selEv = null; etat.courant = id;
    history.replaceState(null, "", "#fresque:" + id);
    panneau();
    if (centrer) { centrerSur(id, !S.debut, !S.debut); S.debut = false; }  // à l'ouverture : on garde la vue 1500-aujourd'hui
    demander();
  }

  /* ----- affichage : tout l'arbre / ancêtres directs d'une personne ----- */
  function majOutils() {
    $("#fr-mode").value = S.mode;
    $("#fr-anc").hidden = S.mode !== "anc";
    $("#fr-gen").value = String(S.gen);
    if (S.mode === "anc" && P.has(S.ref)) {
      $("#fr-refnom").textContent = nomTexte(P.get(S.ref));
      $("#fr-nb").textContent = `${VIS.length.toLocaleString("fr")} personne${VIS.length > 1 ? "s" : ""}`;
    }
  }
  function definirMode(mode, ref) {
    S.mode = mode;
    if (mode === "anc") S.ref = ref || S.sel || etat.courant || D.racine;
    recalculer();
    majOutils();
    const cible = mode === "anc" ? S.ref : (S.sel && P.get(S.sel)._v ? S.sel : null);
    S.selEv = null;
    if (cible) { choisir(cible, { centrer: false }); centrerSur(cible, false, false); }
    else { S.sel = null; panneau(); }
    limiter(); demander();
  }
  $("#fr-mode").addEventListener("change", e => definirMode(e.target.value));
  $("#fr-gen").addEventListener("change", e => { S.gen = +e.target.value; definirMode("anc", S.ref); });
  $("#fr-refset").addEventListener("click", () => { if (S.sel) definirMode("anc", S.sel); });

  /* ----- barre d'outils ----- */
  document.querySelectorAll("[data-z]").forEach(b => b.addEventListener("click", () => zoomer(b.dataset.z === "in" ? 1.6 : 1 / 1.6)));
  $("#fr-plage").addEventListener("change", e => preset(e.target.value));
  $("#fr-dens").addEventListener("change", e => {
    const centre = (S.y0 + (S.H - entete().h) / 2) / S.rowH;
    S.rowH = +e.target.value; S.y0 = centre * S.rowH - (S.H - entete().h) / 2; limiter(); demander();
  });
  $("#fr-f").addEventListener("change", e => { S.montreF = e.target.checked; limiter(); demander(); });
  $("#fr-m").addEventListener("change", e => { S.montreM = e.target.checked; limiter(); demander(); });
  $("#fr-liens").addEventListener("change", e => { S.liens = e.target.value; demander(); });
  const leg = $("#fr-legend");
  leg.innerHTML = Object.entries(CATS).map(([k, [nom, col]]) =>
    `<button type="button" data-c="${k}" aria-pressed="true"><span class="sw" style="background:${col}"></span>${nom}</button>`).join("") +
    `<span style="margin-left:auto;display:inline-flex;gap:10px;align-items:center;color:var(--muted)">` +
    `<span><span class="sw" style="display:inline-block;width:14px;height:9px;border-radius:3px;background:${COUL_SEXE.M}"></span> homme</span>` +
    `<span><span class="sw" style="display:inline-block;width:14px;height:9px;border-radius:3px;background:${COUL_SEXE.F}"></span> femme</span>` +
    `<span><span style="display:inline-block;width:14px;border-top:3px solid ${COUL_SEXE.M};vertical-align:middle"></span> père</span>` +
    `<span><span style="display:inline-block;width:14px;border-top:3px solid ${COUL_SEXE.F};vertical-align:middle"></span> mère</span>` +
    `<span><span style="display:inline-block;width:14px;border-top:2px dashed #d18a10;vertical-align:middle"></span> couple</span>` +
    `<span>barre pâle : dates estimées</span></span>`;
  leg.addEventListener("click", e => {
    const b = e.target.closest("[data-c]"); if (!b) return;
    const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", on);
    on ? S.cats.add(b.dataset.c) : S.cats.delete(b.dataset.c); demander();
  });
  const q = $("#fr-q"), res = $("#fr-res");
  q.addEventListener("input", () => {
    const mots = fold(q.value).split(/\s+/).filter(Boolean);
    if (!mots.length) { res.hidden = true; return; }
    const m = VIS.filter(p => mots.every(w => p._s.includes(w))).slice(0, 8);
    res.innerHTML = m.map(p => `<a href="#fresque:${p.i}">${nomHtml(p)} <small>${esc(vie(p))}</small></a>`).join("") || '<a class="vide">Aucun résultat</a>';
    res.hidden = false;
  });
  res.addEventListener("click", () => { res.hidden = true; q.value = ""; });
  document.addEventListener("click", e => { if (!e.target.closest(".fr-search")) res.hidden = true; });

  /* ----- taille du canevas ----- */
  function redim() {
    const r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    S.dpr = window.devicePixelRatio || 1;
    S.W = Math.round(r.width); S.H = Math.round(r.height);
    cv.width = S.W * S.dpr; cv.height = S.H * S.dpr;
    limiter(); demander();
  }
  new ResizeObserver(redim).observe(wrap);

  function montrer() {
    relire();
    if (sale) charger();
    redim();
    if (!S.pret && S.W) {
      S.pret = true; S.debut = true;
      preset("1500");
      panneau();
    }
    demander();
  }
  /** Données modifiées : recalcul immédiat si la fresque est affichée, sinon à sa prochaine ouverture. */
  function invalider() {
    sale = true;
    if (!$("#fresque").hidden) { charger(); limiter(); panneau(); demander(); }
  }
  return { montrer, choisir, dessiner, definirMode, invalider };
})();

/* ================= Statistiques ================= */
const Stat = (function () {
  let M = [], maxN = 1;   // [{l: intitulé, n: nb de personnes, p: [ids]}], trié par effectif décroissant
  const body = $("#stbody");
  const etat = { q: "", tri: "n", etendu: false };
  const PAS = 40;   // nombre de lignes affichées avant le bouton « Afficher plus »
  let construit = false;

  function liste() {
    const mots = fold(etat.q).split(/\s+/).filter(Boolean);
    const items = M.map((g, i) => ({ g, i })).filter(({ g }) => mots.every(m => fold(g.l).includes(m)));
    if (etat.tri === "alpha") items.sort((a, b) => a.g.l.localeCompare(b.g.l, "fr"));
    return items;
  }
  function ligne({ g, i }) {
    const pct = Math.max(2, Math.round(g.n / maxN * 100));
    return `<div class="st-row" data-i="${i}"><button class="st-row-hd" type="button" aria-expanded="false">` +
      `<span class="car">▸</span><span class="st-label" title="${esc(g.l)}">${esc(g.l)}</span>` +
      `<span class="st-barwrap"><span class="st-bar" style="width:${pct}%"></span></span>` +
      `<span class="st-n">${g.n}</span></button><div class="st-people"></div></div>`;
  }
  function render() {
    const items = liste();
    const visibles = etat.etendu || etat.q ? items : items.slice(0, PAS);
    $("#st-list").innerHTML = visibles.map(ligne).join("") ||
      '<p class="vide">Aucun métier ou titre ne correspond à cette recherche.</p>';
    $("#st-count").textContent = `${items.length.toLocaleString("fr")} intitulé${items.length > 1 ? "s" : ""} distinct${items.length > 1 ? "s" : ""}`;
    const bouton = $("#st-more"), reste = items.length - visibles.length;
    bouton.hidden = reste <= 0;
    if (reste > 0) bouton.textContent = `Afficher les ${reste.toLocaleString("fr")} autres`;
  }
  function construire() {
    body.innerHTML = `<div class="st-hd"><h2>Statistiques</h2></div><p class="st-nums" id="st-nums"></p>` +
      `<section class="card"><h3>Métiers, professions et titres<span class="sp" id="st-count"></span></h3>` +
      `<div class="st-tools"><input id="st-q" type="search" placeholder="Rechercher un métier ou un titre…" autocomplete="off">` +
      `<select id="st-tri"><option value="n">Tri : effectif</option><option value="alpha">Tri : alphabétique</option></select></div>` +
      `<div class="st-list" id="st-list"></div><button class="st-more" id="st-more" type="button" hidden></button></section>`;
    $("#st-q").addEventListener("input", () => { etat.q = $("#st-q").value; render(); });
    $("#st-tri").addEventListener("change", () => { etat.tri = $("#st-tri").value; render(); });
    $("#st-more").addEventListener("click", () => { etat.etendu = true; render(); });
    body.addEventListener("click", e => {
      const b = e.target.closest(".st-row-hd");
      if (!b) return;
      const row = b.closest(".st-row"), g = M[+row.dataset.i];
      const ouvert = row.classList.toggle("open");
      b.setAttribute("aria-expanded", String(ouvert));
      const zone = row.querySelector(".st-people");
      if (ouvert && !zone.childElementCount) zone.innerHTML = trierParNaissance(g.p).map(id => chip(id)).join("");
    });
  }
  function montrer() {
    if (!construit) { construit = true; construire(); }
    if (!D.statistiques) D.statistiques = Modele.statistiques(D.personnes);
    M = D.statistiques.metiers; maxN = M[0]?.n || 1;
    const total = D.personnes.length, avecMetier = D.statistiques.personnes_avec_metier;
    const pct = total ? Math.round(avecMetier / total * 100) : 0;
    $("#st-nums").textContent = `${avecMetier.toLocaleString("fr")} personnes sur ${total.toLocaleString("fr")} (${pct}\u202f%) ont ` +
      `au moins un métier, une profession ou un titre connu — ${D.statistiques.mentions.toLocaleString("fr")} mentions, ` +
      `${M.length.toLocaleString("fr")} intitulés distincts.`;
    render();
  }
  function invalider() { if (construit && !$("#stpage").hidden) montrer(); }
  return { montrer, invalider };
})();

/* ---------- démarrage : connexion au dépôt, chargement, rafraîchissement ---------- */
let premierAffichage = true;
function toast(texte, erreur = false, duree = 5000) {
  const t = $("#toast");
  t.textContent = texte; t.classList.toggle("erreur", erreur); t.hidden = false;
  clearTimeout(toast.minuteur);
  toast.minuteur = setTimeout(() => { t.hidden = true; }, duree);
}
function majEntete() {
  const ans = D.personnes.map(by).filter(y => y && y > 500);
  const nbPhotos = D.personnes.filter(p => p.av || p.ph).length;
  $("#titre").textContent = D.titre || "Arbre familial";
  $("#stats").textContent = `${tousIds.length.toLocaleString("fr")} personnes · ${Object.keys(F).length.toLocaleString("fr")} familles` +
    (ans.length ? ` · de ${Math.min(...ans)} à ${Math.max(...ans)}` : "") + ` · ${nbPhotos} avec photo`;
}
/** Nouvelles données (chargement, modification locale ou de l'autre utilisateur) : tout l'affichage suit. */
function surNouvellesDonnees(B) {
  installerDonnees(Modele.versAffichage(B));
  const r = store.get("racine");
  D.racine = P.has(r) ? r : tousIds[0];
  majEntete();
  renderListe();
  Fresque.invalider();
  Stat.invalider();
  if (premierAffichage) { premierAffichage = false; route(); return; }
  if (onglet === "personnes") {
    if (!P.has(etat.courant)) { location.hash = "#" + D.racine; return; }
    renderFiche(etat.courant);
    const ligne = listEl.querySelector(`[data-id="${etat.courant}"]`);
    if (ligne) ligne.setAttribute("aria-current", "true");
    if (etat.peek && !P.has(etat.peek)) fermerPeek();
  }
}
Depot.surDonnees(surNouvellesDonnees);
Depot.surEtat(e => {
  const el = $("#sync");
  const txt = { ok: e.texte === "Enregistré" ? "✓ Enregistré" : "", enregistre: "⟳ Enregistrement…", charge: "⟳ Chargement…",
    horsligne: "⚠ Non enregistré", erreur: Depot.enAttente ? "⚠ Non enregistré" : "⚠ Modification abandonnée" }[e.type];
  if (txt !== undefined) { el.textContent = txt; el.className = "sync " + e.type; el.title = e.texte || ""; }
  if (e.type === "ok" && e.texte === "Enregistré") setTimeout(() => { if (Depot.etat.type === "ok") el.textContent = ""; }, 4000);
  if (e.type === "horsligne" || e.type === "erreur") toast(e.texte, true, 9000);
  if (e.type === "fusion") toast(e.texte);
});

function montrerConnexion(erreur = "", depot = "") {
  $("#chargement").hidden = true;
  $("#connexion").hidden = false;
  $("#cx-depot").value = depot || Depot.configuration()?.depot || CONFIG.depot || "";
  $("#cx-auteur").value = Depot.configuration()?.auteur || "";
  $("#cx-erreur").hidden = !erreur;
  $("#cx-erreur").textContent = erreur;
  ($("#cx-depot").value ? $("#cx-jeton") : $("#cx-depot")).focus();
}
async function ouvrir(depot, jeton, auteur = "", memoriser = true) {
  $("#connexion").hidden = true;
  $("#chargement").hidden = false;
  $("#chargement-texte").textContent = "Connexion à GitHub…";
  try {
    const u = await Depot.connecter(depot, jeton, { memoriserConnexion: memoriser, auteur });
    $("#chargement-texte").textContent = "Chargement de l’arbre…";
    await Depot.charger();
    $("#menu-info").textContent = `Connecté : ${auteur || u.name || u.login} · ${Depot.depot}`;
    $("#chargement").hidden = true;
  } catch (e) {
    montrerConnexion(e.message, depot);
  }
}
$("#form-connexion").addEventListener("submit", e => {
  e.preventDefault();
  ouvrir($("#cx-depot").value, $("#cx-jeton").value, $("#cx-auteur").value);
});

// menu
const menu = $("#menu");
$("#menu-btn").addEventListener("click", e => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  $("#menu-btn").setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("click", e => { if (!e.target.closest(".menu")) { menu.hidden = true; $("#menu-btn").setAttribute("aria-expanded", "false"); } });
menu.addEventListener("click", async e => {
  const b = e.target.closest("[data-menu]");
  if (!b) return;
  menu.hidden = true;
  const action = b.dataset.menu;
  if (action === "deconnexion") {
    if (Depot.enAttente && !confirm("Des modifications ne sont pas encore enregistrées. Se déconnecter quand même ?")) return;
    Depot.deconnecter();
    location.hash = "";
    location.reload();
  } else if (action === "actualiser") {
    const fait = await Depot.verifierDistant();
    if (!fait) toast("L’arbre est à jour.");
  } else if (action === "gedcom") {
    const texte = Modele.exporterGedcom(Depot.donnees);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([texte], { type: "text/plain;charset=utf-8" }));
    a.download = `arbre-${new Date().toISOString().slice(0, 10)}.ged`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } else {
    Edition.menu(action);
  }
});

// l'autre utilisateur a peut-être enregistré : on vérifie au retour sur la page et toutes les deux minutes
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") Depot.verifierDistant(); });
setInterval(() => { if (document.visibilityState === "visible") Depot.verifierDistant(); }, 120000);

(function demarrer() {
  const c = Depot.configuration();
  if (c) ouvrir(c.depot, c.jeton, c.auteur || "");
  else montrerConnexion();
})();
