"use strict";
/* Modèle de données de l'arbre.
 *
 * Format stocké (arbre.json dans le dépôt privé) : voir importer_gedcom.py. Les dates y sont au format GEDCOM
 * (« 24 MAR 1951 », « ABT 1800 », « BET 1053 AND 1096 ») et les liens de parenté ne vivent que dans les familles.
 * Format d'affichage : champs courts (i, g, n, x, b, dt, e…) attendus par l'interface (interface.js).
 */
const Modele = (() => {
  const FORMAT = "arbre-familial/1";
  const CLES = {
    personne: ["id", "prenoms", "nom", "sexe", "usage", "surnom", "prefixe", "suffixe", "naissance", "deces",
      "evenements", "notes", "sources", "photos", "portrait", "emails", "adresses"],
    famille: ["id", "pere", "mere", "enfants", "mariage", "evenements", "notes", "sources"],
    evenement: ["type", "valeur", "date", "lieu", "age", "cause", "note"],
    source: ["titre", "page", "extrait"],
    photo: ["fichier", "titre", "date"],
  };

  /* ---------------- dates ---------------- */
  const MOIS = { JAN: "janvier", FEB: "février", MAR: "mars", APR: "avril", MAY: "mai", JUN: "juin", JUL: "juillet",
    AUG: "août", SEP: "septembre", OCT: "octobre", NOV: "novembre", DEC: "décembre" };
  const CODES_MOIS = Object.keys(MOIS);
  const MODIF = { ABT: "vers", EST: "vers", CAL: "vers", BEF: "avant", AFT: "après", FROM: "de", TO: "jusqu'à", INT: "" };
  const DATE_SIMPLE = new RegExp(`^(?:(\\d{1,2}) )?(?:(${CODES_MOIS.join("|")}) )?(\\d{3,4})$`);

  /** « 24 MAR 1951 » -> « 24 mars 1951 » ; « BET 1053 AND 1096 » -> « entre 1053 et 1096 ». */
  function dateFr(s) {
    s = (s || "").trim();
    if (!s || s === "()" || s === "Y") return "";
    let t = s.replace(/\(.*?\)/g, "").trim().replace(/^(?:FROM|FM)\b/, "FROM");
    let m = t.match(/^BET (.+) AND (.+)$/);
    if (m) return `entre ${dateFr(m[1])} et ${dateFr(m[2])}`;
    m = t.match(/^FROM (.+) TO (.+)$/);
    if (m) return `de ${dateFr(m[1])} à ${dateFr(m[2])}`;
    const mots = t.split(/\s+/);
    return mots.map((w, i) => {
      if (w in MODIF) return MODIF[w];
      if (w in MOIS) return MOIS[w];
      if (w === "1" && mots[i + 1] in MOIS) return "1er";
      return w;
    }).filter(Boolean).join(" ");
  }
  function annee(s) {
    const m = String(s || "").match(/(?<!\d)(\d{3,4})(?!\d)/);
    return m ? +m[1] : null;
  }
  /** Âge (texte) entre deux dates GEDCOM, « environ » si l'une est imprécise. */
  function ageEntre(d1, d2) {
    const y1 = annee(d1), y2 = annee(d2);
    if (y1 === null || y2 === null || y2 < y1) return "";
    const m1 = (d1 || "").trim().match(DATE_SIMPLE), m2 = (d2 || "").trim().match(DATE_SIMPLE);
    const exact = !!(m1 && m2);
    let age = y2 - y1;
    if (exact && m1[1] && m1[2] && m2[1] && m2[2]) {
      if (CODES_MOIS.indexOf(m2[2]) * 100 + +m2[1] < CODES_MOIS.indexOf(m1[2]) * 100 + +m1[1]) age--;
    } else if (exact && m1[2] && m2[2]) {
      if (CODES_MOIS.indexOf(m2[2]) < CODES_MOIS.indexOf(m1[2])) age--;
    }
    if (age > 120) return "";
    if (age === 0) return "moins d'un an";
    return `${exact ? "" : "environ "}${age} an${age > 1 ? "s" : ""}`;
  }
  /** « 72y 3m » -> « 72 ans 3 mois ». */
  function ageGedcom(a) {
    a = (a || "").trim();
    if (!a) return "";
    const m = [...a.matchAll(/(\d+)([ymd])/g)];
    if (m.length) {
      const u = { y: ["an", "ans"], m: ["mois", "mois"], d: ["jour", "jours"] };
      return m.map(([, n, k]) => `${n} ${u[k][n === "1" ? 0 : 1]}`).join(" ");
    }
    return { CHILD: "enfant", INFANT: "nourrisson", STILLBORN: "mort-né" }[a.toUpperCase()] || a;
  }

  /* Saisie en français -> date GEDCOM. Accepte « 24/03/1951 », « 24 mars 1951 », « 1er mai 1897 », « mars 1951 »,
     « 1951 », « vers 1800 », « avant 1700 », « après 1750 », « entre 1053 et 1096 », « de 1900 à 1910 »,
     ou directement une date GEDCOM (« ABT 1800 »). */
  const MOIS_SAISIE = [["janvier", "janv", "jan"], ["fevrier", "fevr", "fev"], ["mars", "mar"], ["avril", "avr"],
    ["mai"], ["juin"], ["juillet", "juil", "jul"], ["aout"], ["septembre", "sept", "sep"], ["octobre", "oct"],
    ["novembre", "nov"], ["decembre", "dec"]];
  const sansAccent = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function moisDe(mot) {
    mot = mot.replace(/\.$/, "");
    const i = MOIS_SAISIE.findIndex(l => l.includes(mot));
    return i < 0 ? null : CODES_MOIS[i];
  }
  function dateValide(j, m, a) {
    if (a < 1 || a > 2100) return false;
    if (m === undefined) return true;
    if (j === undefined) return true;
    return j >= 1 && j <= new Date(a, CODES_MOIS.indexOf(m) + 1, 0).getDate();
  }
  function dateSimple(t) {
    let m;
    if ((m = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{3,4})$/))) {
      const mo = CODES_MOIS[+m[2] - 1];
      return mo && dateValide(+m[1], mo, +m[3]) ? `${+m[1]} ${mo} ${+m[3]}` : null;
    }
    if ((m = t.match(/^(\d{1,2})[/.\-](\d{3,4})$/))) {
      const mo = CODES_MOIS[+m[1] - 1];
      return mo ? `${mo} ${+m[2]}` : null;
    }
    if ((m = t.match(/^(\d{3,4})$/))) return String(+m[1]);
    if ((m = t.match(/^(?:(\d{1,2})(?:er)? )?([a-z.]+) (\d{3,4})$/))) {
      const mo = moisDe(m[2]);
      if (!mo) return null;
      if (m[1] && !dateValide(+m[1], mo, +m[3])) return null;
      return `${m[1] ? +m[1] + " " : ""}${mo} ${+m[3]}`;
    }
    return null;
  }
  const RE_GEDCOM_SIMPLE = `(?:\\d{1,2} )?(?:(?:${CODES_MOIS.join("|")}) )?\\d{3,4}`;
  const RE_GEDCOM = new RegExp(`^(?:(?:(?:ABT|EST|CAL|BEF|AFT|FROM|TO|INT) )?${RE_GEDCOM_SIMPLE}|BET ${RE_GEDCOM_SIMPLE} AND ${RE_GEDCOM_SIMPLE}|FROM ${RE_GEDCOM_SIMPLE} TO ${RE_GEDCOM_SIMPLE})$`);
  /** -> { gedcom, erreur } ; gedcom vide si la saisie est vide. */
  function lireDate(saisie) {
    const brut = String(saisie || "").trim();
    if (!brut || brut === "?") return { gedcom: "" };
    if (RE_GEDCOM.test(brut.toUpperCase().replace(/\s+/g, " "))) return { gedcom: brut.toUpperCase().replace(/\s+/g, " ") };
    const t = sansAccent(brut).replace(/,/g, " ").replace(/\s+/g, " ").replace(/^le /, "").trim();
    let m;
    if ((m = t.match(/^entre (.+) et (.+)$/)) || (m = t.match(/^(\d{3,4}) ?[-/] ?(\d{3,4})$/))) {
      const a = dateSimple(m[1]), b = dateSimple(m[2]);
      return a && b ? { gedcom: `BET ${a} AND ${b}` } : { erreur: "Date non reconnue" };
    }
    if ((m = t.match(/^(?:de|du) (.+) (?:a|au|jusqu'a|jusqu'au) (.+)$/))) {
      const a = dateSimple(m[1]), b = dateSimple(m[2]);
      return a && b ? { gedcom: `FROM ${a} TO ${b}` } : { erreur: "Date non reconnue" };
    }
    const prefixes = [[/^(?:vers|environ|env\.?|v\.|ca\.?|circa|~) ?/, "ABT"], [/^(?:avant|av\.?) /, "BEF"],
      [/^(?:apres|ap\.?) /, "AFT"], [/^(?:estime|estimee) /, "EST"], [/^(?:depuis|a partir de|des|de|du) /, "FROM"],
      [/^jusqu'(?:a|en) /, "TO"]];
    for (const [re, code] of prefixes) {
      if (re.test(t)) {
        const d = dateSimple(t.replace(re, "").trim());
        return d ? { gedcom: `${code} ${d}` } : { erreur: "Date non reconnue" };
      }
    }
    const d = dateSimple(t);
    return d ? { gedcom: d } : { erreur: "Date non reconnue (ex. : 24/03/1951, mars 1951, vers 1800)" };
  }
  /** Date GEDCOM -> texte proposé dans un champ de saisie. */
  function dateSaisie(gedcom) { return dateFr(gedcom); }

  /* ---------------- format stocké ---------------- */
  function ordonner(d, cles) {
    const r = {};
    for (const k of cles) {
      const v = d[k];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
      r[k] = v;
    }
    return r;
  }
  const nettoyerEv = e => ordonner(e, CLES.evenement);
  function nettoyerPersonne(p) {
    const q = { ...p };
    for (const k of ["naissance", "deces"]) if (q[k]) { q[k] = nettoyerEv(q[k]); delete q[k].type; }
    if (q.naissance && !Object.keys(q.naissance).length) delete q.naissance;   // naissance vide = rien de connu
    q.evenements = (q.evenements || []).map(nettoyerEv).filter(e => Object.keys(e).length > 1);
    q.sources = (q.sources || []).map(s => ordonner(s, CLES.source)).filter(s => s.titre || s.page);
    q.photos = (q.photos || []).map(x => ordonner(x, CLES.photo)).filter(x => x.fichier);
    for (const k of ["usage", "notes", "emails", "adresses"]) q[k] = (q[k] || []).map(x => String(x).trim()).filter(Boolean);
    return ordonner(q, CLES.personne);     // « deces »: {} (décédé, rien de connu) est conservé
  }
  function nettoyerFamille(f) {
    const q = { ...f };
    if (q.mariage) { q.mariage = nettoyerEv(q.mariage); delete q.mariage.type; }
    q.evenements = (q.evenements || []).map(nettoyerEv).filter(e => e.type);
    q.sources = (q.sources || []).map(s => ordonner(s, CLES.source)).filter(s => s.titre || s.page);
    q.notes = (q.notes || []).map(x => String(x).trim()).filter(Boolean);
    q.enfants = [...new Set(q.enfants || [])];
    return ordonner(q, CLES.famille);
  }
  /** Même présentation que importer_gedcom.py : une personne / famille par ligne (diffs Git lisibles). */
  function serialiser(B) {
    const ligne = r => JSON.stringify(r);
    return "{\n" + `"format":${JSON.stringify(FORMAT)},\n"titre":${JSON.stringify(B.titre || "")},\n` +
      '"personnes":[\n' + B.personnes.map(p => ligne(nettoyerPersonne(p))).join(",\n") + "\n],\n" +
      '"familles":[\n' + B.familles.map(f => ligne(nettoyerFamille(f))).join(",\n") + "\n]\n}\n";
  }
  function lire(texte) {
    const B = JSON.parse(texte);
    if (B.format !== FORMAT) throw new Error(`Format de données inattendu (${B.format || "inconnu"})`);
    return B;
  }
  const cloner = B => typeof structuredClone === "function" ? structuredClone(B) : JSON.parse(JSON.stringify(B));
  function nouvelId(prefixe) {
    return prefixe + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------------- format d'affichage ---------------- */
  function evAff(e, type) {
    const r = { t: e.type || type };
    if (e.valeur) r.v = e.valeur;
    if (e.date) { r.d = dateFr(e.date); r.y = annee(e.date); r.r = e.date; }
    if (e.lieu) r.p = e.lieu;
    if (e.age) r.a = ageGedcom(e.age);
    if (e.cause) r.c = e.cause;
    if (e.note) r.n = [e.note];
    return r;
  }
  const srcAff = s => ({ t: s.titre || "", ...(s.page ? { p: s.page } : {}), ...(s.extrait ? { x: s.extrait } : {}) });

  /** Format stocké -> { personnes: [...], familles: {id: ...} } attendus par l'interface. */
  function versAffichage(B) {
    const familles = {}, fc = new Map(), fs = new Map();
    const ajouter = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    for (const f of B.familles) {
      const d = { c: [...(f.enfants || [])] };
      if (f.pere) d.h = f.pere;
      if (f.mere) d.w = f.mere;
      if (f.mariage) d.m = evAff(f.mariage, "Mariage");
      if (f.evenements?.length) d.e = f.evenements.map(e => evAff(e));
      if (f.notes?.length) d.n = [...f.notes];
      if (f.sources?.length) d.s = f.sources.map(srcAff);
      familles[f.id] = d;
      for (const x of [f.pere, f.mere]) if (x) ajouter(fs, x, f.id);
      for (const c of d.c) ajouter(fc, c, f.id);
    }
    const personnes = B.personnes.map(p => {
      const d = { i: p.id, g: p.prenoms || "", n: p.nom || "", x: p.sexe || "U" };
      if (p.usage?.length) d.mn = [...p.usage];
      if (p.surnom) d.nk = p.surnom;
      if (p.prefixe) d.pf = p.prefixe;
      if (p.suffixe) d.sf = p.suffixe;
      if (p.naissance) d.b = evAff(p.naissance, "Naissance");
      if (p.deces) {
        d.dt = evAff(p.deces, "Décès");
        if (!p.deces.date) d.dt.inc = 1;
        if (!d.dt.a && p.naissance?.date && p.deces.date) d.dt.a = ageEntre(p.naissance.date, p.deces.date);
      }
      const ev = (p.evenements || []).map(e => evAff(e));
      ev.sort((a, b) => (a.y == null) - (b.y == null) || (a.y || 0) - (b.y || 0));
      if (ev.length) d.e = ev;
      if (p.emails?.length) d.em = [...p.emails];
      if (p.adresses?.length) d.ad = [...p.adresses];
      if (p.notes?.length) d.nt = [...p.notes];
      if (p.sources?.length) d.s = p.sources.map(srcAff);
      if (p.portrait) d.av = p.portrait;
      if (p.photos?.length) d.ph = p.photos.map(x => ({ u: x.fichier, ...(x.titre ? { t: x.titre } : {}), ...(x.date ? { d: dateFr(x.date) } : {}) }));
      if (fc.has(p.id)) d.fc = fc.get(p.id);
      if (fs.has(p.id)) d.fs = fs.get(p.id);
      return d;
    });
    const dates = estimerDates(personnes, familles);
    for (const p of personnes) { const [s, e, se, ee] = dates.get(p.i); p.fr = [0, s, e, (se ? 1 : 0) | (ee ? 2 : 0)]; }
    return { titre: B.titre, personnes, familles };
  }

  /* ---------------- fresque : dates estimées et placement (portage de disposition.py) ---------------- */
  const ANNEE_COURANTE = new Date().getFullYear(), AGE_PAR_DEFAUT = 65, ECART_GENERATION = 30;
  const COMPACTION = 0.35, MARGE = 1.5;
  function liensAff(personnes, familles) {
    const ids = new Set(personnes.map(p => p.i));
    const parents = new Map(), enfants = new Map(), conjoints = new Map(), fratrie = new Map();
    for (const i of ids) { parents.set(i, []); enfants.set(i, []); conjoints.set(i, []); fratrie.set(i, new Set()); }
    for (const f of Object.values(familles)) {
      const h = ids.has(f.h) ? f.h : null, w = ids.has(f.w) ? f.w : null;
      const cs = f.c.filter(c => ids.has(c));
      if (h && w) {
        if (!conjoints.get(h).includes(w)) conjoints.get(h).push(w);
        if (!conjoints.get(w).includes(h)) conjoints.get(w).push(h);
      }
      for (const c of cs) {
        parents.get(c).push([h, w]);
        for (const x of [h, w]) if (x) enfants.get(x).push(c);
        for (const o of cs) if (o !== c) fratrie.get(c).add(o);
      }
    }
    return { parents, enfants, conjoints, fratrie };
  }
  /** Map id -> [début, fin, début estimé ?, fin estimée ?] (années). */
  function estimerDates(personnes, familles) {
    const { parents, enfants, conjoints, fratrie } = liensAff(personnes, familles);
    const naiss = new Map(personnes.map(p => [p.i, p.b?.y ?? null]));
    const deces = new Map(personnes.map(p => [p.i, p.dt?.y ?? null]));
    const mort = new Map(personnes.map(p => [p.i, !!p.dt]));
    const debut = new Map([...naiss].filter(([, y]) => y));
    const estime = new Set();
    for (let tour = 0; tour < 12; tour++) {
      const nouveau = new Map();
      for (const i of naiss.keys()) {
        if (debut.has(i)) continue;
        const c = [];
        for (const [h, w] of parents.get(i)) {
          if (debut.has(h)) c.push(debut.get(h) + ECART_GENERATION);
          if (debut.has(w)) c.push(debut.get(w) + ECART_GENERATION - 3);
        }
        for (const x of enfants.get(i)) if (debut.has(x)) c.push(debut.get(x) - ECART_GENERATION);
        for (const x of conjoints.get(i)) if (debut.has(x)) c.push(debut.get(x));
        for (const x of fratrie.get(i)) if (debut.has(x)) c.push(debut.get(x));
        if (deces.get(i)) c.push(deces.get(i) - AGE_PAR_DEFAUT);
        if (c.length) nouveau.set(i, Math.round(c.reduce((a, b) => a + b, 0) / c.length));
      }
      if (!nouveau.size) break;
      for (const [i, y] of nouveau) { debut.set(i, y); estime.add(i); }
    }
    for (const i of naiss.keys()) if (!debut.has(i)) { debut.set(i, 1750); estime.add(i); }
    const res = new Map();
    for (const i of naiss.keys()) {
      const s = debut.get(i);
      let e = deces.get(i), finEst = false;
      if (!e) {
        const vivant = !mort.get(i) && s > ANNEE_COURANTE - 100;
        e = vivant ? ANNEE_COURANTE : Math.min(s + AGE_PAR_DEFAUT, ANNEE_COURANTE);
        finEst = !vivant;
      }
      if (e < s) e = s + 1;
      res.set(i, [s, e, estime.has(i), finEst]);
    }
    return res;
  }
  const arrondi = x => (Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x));  // comme round() de Python
  /** Ligne de chaque personne sur la fresque ; remplit p.fr[0]. */
  function disposer(personnes, familles, racine) {
    const { parents, enfants, conjoints, fratrie } = liensAff(personnes, familles);
    const ids = personnes.map(p => p.i);
    const dates = new Map(personnes.map(p => [p.i, p.fr]));
    const memo = new Map();
    const ancetres = (i, pile) => {
      if (memo.has(i)) return memo.get(i);
      if (pile.has(i)) return new Set();
      pile.add(i);
      const s = new Set();
      for (const [h, w] of parents.get(i)) for (const x of [h, w]) if (x) { s.add(x); for (const y of ancetres(x, pile)) s.add(y); }
      pile.delete(i);
      memo.set(i, s);
      return s;
    };
    const taille = new Map(ids.map(i => [i, ancetres(i, new Set()).size]));
    const lignes = new Map(), rang = new Map();
    const libre = (r, s, e) => (lignes.get(r) || []).every(([a, b]) => e + MARGE <= a || s - MARGE >= b);
    const placer = (i, souhait) => {
      const [, s, e] = dates.get(i), base = arrondi(souhait);
      for (let d = 0; ; d++) for (const r of d ? [base + d, base - d] : [base]) if (libre(r, s, e)) {
        if (!lignes.has(r)) lignes.set(r, []);
        lignes.get(r).push([s, e]); rang.set(i, r); return;
      }
    };
    if (!ids.length) return;
    racine = ids.includes(racine) ? racine : ids[0];
    placer(racine, 0);
    const file = [racine];
    for (let k = 0; k < file.length; k++) {
      const x = file[k], rx = rang.get(x);
      for (const [h, w] of parents.get(x).slice(0, 1)) {
        if (h && !rang.has(h)) { placer(h, rx - 1 - COMPACTION * taille.get(h) / 2); file.push(h); }
        if (w && !rang.has(w)) { placer(w, rx + 1 + COMPACTION * taille.get(w) / 2); file.push(w); }
      }
      conjoints.get(x).forEach((c, j) => {
        if (!rang.has(c)) { placer(c, rx + (j % 2 === 0 ? 1 : -1) * (1 + Math.floor(j / 2))); file.push(c); }
      });
      const cs = [...new Set(enfants.get(x))].filter(c => !rang.has(c));
      cs.forEach((c, j) => { placer(c, rx + (j - (cs.length - 1) / 2)); file.push(c); });
      for (const c of [...fratrie.get(x)].sort()) if (!rang.has(c)) { placer(c, rx + 1); file.push(c); }
    }
    for (const i of ids) if (!rang.has(i)) placer(i, Math.max(...rang.values()) + 1);
    const utilises = [...new Set(rang.values())].sort((a, b) => a - b), renum = new Map(utilises.map((r, k) => [r, k]));
    for (const p of personnes) p.fr[0] = renum.get(rang.get(p.i));
  }

  /* ---------------- statistiques (portage de statistiques.py) ---------------- */
  const cleIntitule = t => sansAccent(t).replace(/[^a-z0-9]+/g, " ").trim();
  const rugosite = t => (t.length > 3 && t === t.toUpperCase() && t !== t.toLowerCase() ? 2 : t === t.toLowerCase() ? 1 : 0);
  function meilleureForme(a, b) {
    const ra = rugosite(a), rb = rugosite(b);
    if (ra !== rb) return ra < rb ? a : b;
    return a.length <= b.length ? a : b;
  }
  function statistiques(personnes) {
    const groupes = new Map();
    for (const p of personnes) {
      const vus = new Set();
      for (const e of p.e || []) {
        if (e.t !== "Profession" && e.t !== "Titre") continue;
        const texte = (e.v || "").trim().replace(/^[•·\-–— ]+/, "").trim().replace(/^\.+|\.+$/g, "");
        if (!texte || texte.length > 70 || texte.includes("\n")) continue;
        const cle = cleIntitule(texte);
        if (!cle || vus.has(cle)) continue;
        vus.add(cle);
        if (!groupes.has(cle)) groupes.set(cle, { l: texte, n: 0, p: [] });
        const g = groupes.get(cle);
        g.l = meilleureForme(g.l, texte); g.n++; g.p.push(p.i);
      }
    }
    const metiers = [...groupes.values()].sort((a, b) => b.n - a.n || (a.l < b.l ? -1 : a.l > b.l ? 1 : 0));
    const avec = new Set(metiers.flatMap(g => g.p));
    return { metiers, personnes_avec_metier: avec.size, mentions: metiers.reduce((s, g) => s + g.n, 0) };
  }

  /* ---------------- export GEDCOM ---------------- */
  const TAGS = { Profession: "OCCU", Titre: "TITL", "Baptême": "BAPM", Inhumation: "BURI", "Résidence": "RESI",
    Recensement: "CENS", Religion: "RELI", "Nationalité": "NATI", Formation: "EDUC", "Émigration": "EMIG",
    Immigration: "IMMI", Testament: "WILL", Description: "DSCR", "Propriété": "PROP", "Crémation": "CREM",
    "Diplôme": "GRAD", Retraite: "RETI", Confirmation: "CONF", Homologation: "PROB", "Nombre d'enfants": "NCHI",
    Divorce: "DIV", "Contrat de mariage": "MARC", "Fiançailles": "ENGA", "Bans de mariage": "MARB",
    Annulation: "ANUL", "Demande de divorce": "DIVF" };
  const ATTRIBUTS = new Set(["OCCU", "TITL", "RELI", "NATI", "EDUC", "DSCR", "PROP", "NCHI"]);
  function exporterGedcom(B) {
    const L = [];
    const texte = (niv, tag, val) => {   // lignes de 255 caractères au plus : CONC / CONT
      const lignes = String(val ?? "").replace(/\r/g, "").split("\n");
      lignes.forEach((l, i) => {
        const morceaux = l.match(/.{1,200}/gs) || [""];
        morceaux.forEach((m, j) => L.push(i === 0 && j === 0 ? `${niv} ${tag}${m ? " " + m : ""}` : `${niv + 1} ${j === 0 ? "CONT" : "CONC"}${m ? " " + m : ""}`));
      });
    };
    const sources = new Map();
    const refSource = t => { if (!sources.has(t)) sources.set(t, `@S${sources.size + 1}@`); return sources.get(t); };
    const details = (niv, e) => {
      if (e.date) L.push(`${niv} DATE ${e.date}`);
      if (e.lieu) texte(niv, "PLAC", e.lieu);
      if (e.age) L.push(`${niv} AGE ${e.age}`);
      if (e.cause) texte(niv, "CAUS", e.cause);
      if (e.note) texte(niv, "NOTE", e.note);
    };
    const evenement = e => {
      const tag = TAGS[e.type];
      if (!tag) { texte(1, "EVEN", e.valeur || ""); L.push(`2 TYPE ${e.type}`); }
      else if (ATTRIBUTS.has(tag)) texte(1, tag, e.valeur || "");
      else { L.push(`1 ${tag}${e.valeur ? "" : " Y"}`); if (e.valeur) texte(2, "NOTE", e.valeur); }
      details(2, e);
    };
    const citations = liste => (liste || []).forEach(s => {
      L.push(`1 SOUR ${refSource(s.titre || s.page)}`);
      if (s.page) texte(2, "PAGE", s.page);
      if (s.extrait) { L.push("2 DATA"); texte(3, "TEXT", s.extrait); }
    });
    L.push("0 HEAD", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8", "1 LANG French",
      "1 SOUR ARBRE_FAMILIAL", "2 NAME Arbre familial (application maison)", `1 DATE ${gedcomAujourdhui()}`);
    const fc = new Map(), fs = new Map();
    for (const f of B.familles) {
      for (const x of [f.pere, f.mere]) if (x) (fs.get(x) || fs.set(x, []).get(x)).push(f.id);
      for (const c of f.enfants || []) (fc.get(c) || fc.set(c, []).get(c)).push(f.id);
    }
    for (const p of B.personnes) {
      L.push(`0 @${p.id}@ INDI`);
      L.push(`1 NAME ${p.prenoms || ""} /${p.nom || ""}/${p.suffixe ? " " + p.suffixe : ""}`.replace(/ +/g, " "));
      if (p.prenoms) L.push(`2 GIVN ${p.prenoms}`);
      if (p.nom) L.push(`2 SURN ${p.nom}`);
      if (p.prefixe) L.push(`2 NPFX ${p.prefixe}`);
      if (p.suffixe) L.push(`2 NSFX ${p.suffixe}`);
      if (p.surnom) L.push(`2 NICK ${p.surnom}`);
      for (const u of p.usage || []) L.push(`2 _MARNM ${u}`);
      L.push(`1 SEX ${p.sexe || "U"}`);
      if (p.naissance) { L.push("1 BIRT"); details(2, p.naissance); }
      if (p.deces) { L.push(`1 DEAT${p.deces.date || p.deces.lieu ? "" : " Y"}`); details(2, p.deces); }
      (p.evenements || []).forEach(evenement);
      if (p.emails?.length || p.adresses?.length) {
        L.push("1 RESI");
        for (const a of p.adresses || []) texte(2, "ADDR", a);
        for (const m of p.emails || []) L.push(`2 EMAIL ${m}`);
      }
      for (const n of p.notes || []) texte(1, "NOTE", n);
      citations(p.sources);
      const photos = [...(p.portrait ? [{ fichier: p.portrait, principal: true }] : []), ...(p.photos || [])];
      for (const o of photos) {
        L.push("1 OBJE", "2 FORM jpg", `2 FILE ${o.fichier}`);
        if (o.titre) texte(2, "TITL", o.titre);
        if (o.principal) L.push("2 _PRIM Y");
      }
      for (const f of fc.get(p.id) || []) L.push(`1 FAMC @${f}@`);
      for (const f of fs.get(p.id) || []) L.push(`1 FAMS @${f}@`);
    }
    for (const f of B.familles) {
      L.push(`0 @${f.id}@ FAM`);
      if (f.pere) L.push(`1 HUSB @${f.pere}@`);
      if (f.mere) L.push(`1 WIFE @${f.mere}@`);
      for (const c of f.enfants || []) L.push(`1 CHIL @${c}@`);
      if (f.mariage) { L.push(`1 MARR${Object.keys(f.mariage).length ? "" : " Y"}`); details(2, f.mariage); }
      (f.evenements || []).forEach(evenement);
      for (const n of f.notes || []) texte(1, "NOTE", n);
      citations(f.sources);
    }
    for (const [titre, ref] of sources) { L.push(`0 ${ref} SOUR`); texte(1, "TITL", titre); }
    L.push("0 TRLR");
    return L.join("\r\n") + "\r\n";
  }
  function gedcomAujourdhui() {
    const d = new Date();
    return `${d.getDate()} ${CODES_MOIS[d.getMonth()]} ${d.getFullYear()}`;
  }

  return { FORMAT, dateFr, annee, ageEntre, ageGedcom, lireDate, dateSaisie, sansAccent, serialiser, lire, cloner,
    nouvelId, nettoyerPersonne, nettoyerFamille, versAffichage, disposer, statistiques, exporterGedcom };
})();
