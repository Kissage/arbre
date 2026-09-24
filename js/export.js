"use strict";
/* Onglet Export : fichier GEDCOM seul, ou GEDCOM + photos dans un .zip, avec options de confidentialité
   (personnes vivantes, coordonnées, notes et sources). Tout est préparé dans le navigateur. */
const Export = (() => {
  const body = $("#exbody");
  const ANNEE = new Date().getFullYear();
  let construit = false, enCours = false;

  /** Probablement vivante : pas de décès connu, et née (ou estimée née) il y a moins de 100 ans. */
  function vivante(p) {
    if (p.deces) return false;
    const aff = P.get(p.id);
    const y = aff?.b?.y ?? aff?.fr?.[1];
    return y != null && y > ANNEE - 100;
  }
  function options() {
    const f = body.querySelector("form");
    return { vivants: f.elements.vivants.value, coordonnees: f.elements.coordonnees.checked,
      notes: f.elements.notes.checked, photos: f.elements.photos.checked };
  }
  /** Copie des données selon les options (les données en ligne ne sont jamais modifiées). */
  function preparer(o) {
    const B = Modele.cloner(Depot.donnees);
    const vivants = new Set(B.personnes.filter(vivante).map(p => p.id));
    if (o.vivants === "exclure") {
      B.personnes = B.personnes.filter(p => !vivants.has(p.id));
      for (const f of B.familles) {
        if (vivants.has(f.pere)) f.pere = "";
        if (vivants.has(f.mere)) f.mere = "";
        f.enfants = (f.enfants || []).filter(c => !vivants.has(c));
      }
      B.familles = B.familles.filter(f => [f.pere, f.mere].filter(Boolean).length + (f.enfants || []).length > 1);
    } else if (o.vivants === "masquer") {
      B.personnes = B.personnes.map(p => vivants.has(p.id) ? { id: p.id, prenoms: p.prenoms, nom: p.nom, sexe: p.sexe } : p);
      for (const f of B.familles) {
        if (vivants.has(f.pere) || vivants.has(f.mere)) { delete f.mariage; delete f.evenements; delete f.notes; delete f.sources; }
      }
    }
    if (!o.coordonnees) for (const p of B.personnes) { delete p.emails; delete p.adresses; }
    if (!o.notes) {
      const sansNote = e => { if (e) delete e.note; };
      for (const p of B.personnes) {
        delete p.notes; delete p.sources;
        sansNote(p.naissance); sansNote(p.deces); (p.evenements || []).forEach(sansNote);
      }
      for (const f of B.familles) { delete f.notes; delete f.sources; sansNote(f.mariage); (f.evenements || []).forEach(sansNote); }
    }
    if (!o.photos) for (const p of B.personnes) { delete p.photos; delete p.portrait; }
    const photos = [...new Set(B.personnes.flatMap(p => [p.portrait, ...(p.photos || []).map(x => x.fichier)]).filter(Boolean))];
    return { B, vivants: vivants.size, photos };
  }

  /* ---------------- ZIP (sans compression : les photos JPEG sont déjà compressées) ---------------- */
  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = o => { let c = 0xFFFFFFFF; for (let i = 0; i < o.length; i++) c = TABLE[(c ^ o[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(fichiers) {   // [{ nom, octets: Uint8Array }] -> Blob
    const enc = new TextEncoder(), parts = [], central = [];
    const d = new Date();
    const heure = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const jour = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let position = 0;
    for (const f of fichiers) {
      const nom = enc.encode(f.nom), crc = crc32(f.octets), n = f.octets.length;
      const l = new DataView(new ArrayBuffer(30));
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true);   // noms en UTF-8
      l.setUint16(10, heure, true); l.setUint16(12, jour, true); l.setUint32(14, crc, true);
      l.setUint32(18, n, true); l.setUint32(22, n, true); l.setUint16(26, nom.length, true);
      parts.push(l.buffer, nom, f.octets);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(12, heure, true); c.setUint16(14, jour, true); c.setUint32(16, crc, true);
      c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, nom.length, true); c.setUint32(42, position, true);
      central.push(c.buffer, nom);
      position += 30 + nom.length + n;
    }
    const taille = central.reduce((s, x) => s + x.byteLength, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, fichiers.length, true); fin.setUint16(10, fichiers.length, true);
    fin.setUint32(12, taille, true); fin.setUint32(16, position, true);
    return new Blob([...parts, ...central, fin.buffer], { type: "application/zip" });
  }

  function telecharger(blob, nom) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nom;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const nomFichier = ext => {             // date locale (toISOString donnerait la date en heure universelle)
    const d = new Date(), z = n => String(n).padStart(2, "0");
    return `arbre-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}.${ext}`;
  };

  async function exporter(avecPhotos) {
    if (enCours) return;
    enCours = true;
    const etatEl = body.querySelector("#ex-etat"), boutons = body.querySelectorAll("[data-ex]");
    boutons.forEach(b => { b.disabled = true; });
    try {
      const { B, photos } = preparer(options());
      const ged = new TextEncoder().encode(Modele.exporterGedcom(B));
      if (!avecPhotos) { telecharger(new Blob([ged], { type: "text/plain;charset=utf-8" }), nomFichier("ged")); etatEl.textContent = "Fichier GEDCOM téléchargé."; return; }
      const fichiers = [{ nom: nomFichier("ged"), octets: ged }];
      let faites = 0, echecs = 0;
      const file = photos.slice();
      const ouvrier = async () => {
        while (file.length) {
          const chemin = file.shift();
          let o = null;
          for (let essai = 0; essai < 3 && !o; essai++) {   // un raté réseau passager ne doit pas faire perdre la photo
            try { o = await Depot.octetsPhoto(chemin); if (!o) break; } catch { await new Promise(r => setTimeout(r, 800 * (essai + 1))); }
          }
          if (o) fichiers.push({ nom: chemin, octets: o }); else echecs++;
          etatEl.textContent = `Récupération des photos : ${++faites} / ${photos.length}…`;
        }
      };
      await Promise.all(Array.from({ length: 6 }, ouvrier));
      etatEl.textContent = "Création du fichier .zip…";
      telecharger(zip(fichiers), nomFichier("zip"));
      etatEl.textContent = `Fichier .zip téléchargé : le GEDCOM et ${fichiers.length - 1} photo${fichiers.length > 2 ? "s" : ""}` +
        (echecs ? ` (${echecs} photo${echecs > 1 ? "s" : ""} introuvable${echecs > 1 ? "s" : ""}).` : ".");
    } catch (e) {
      etatEl.textContent = `Export impossible : ${e.message}`;
    } finally {
      enCours = false;
      boutons.forEach(b => { b.disabled = false; });
      majResume();
    }
  }

  function majResume() {
    if (!construit || !Depot.donnees) return;
    const o = options(), { B, vivants, photos } = preparer(o);
    const n = x => x.toLocaleString("fr");
    body.querySelector("#ex-resume").textContent =
      `${n(B.personnes.length)} personnes · ${n(B.familles.length)} familles · ${n(photos.length)} photos` +
      (o.vivants === "tout" ? ` · dont ${n(vivants)} personnes probablement vivantes` : "");
    body.querySelector('[data-ex="zip"]').disabled = enCours || !o.photos;
  }
  function construire() {
    body.innerHTML = `<div class="st-hd"><h2>Export GEDCOM</h2></div>` +
      `<p class="st-nums">Le format GEDCOM est lu par tous les logiciels et sites de généalogie (MyHeritage, Geneanet, Heredis, ` +
      `Gramps…). Gardez-en un de temps en temps comme sauvegarde.</p>` +
      `<form class="card" onsubmit="return false"><h3>Contenu</h3><p id="ex-resume" style="margin:0 0 12px"></p>` +
      `<div class="champ">Personnes probablement vivantes <span class="aide">(sans décès connu, nées il y a moins de 100 ans)</span>` +
      `<div class="radios" style="flex-direction:column;gap:6px">` +
      `<label><input type="radio" name="vivants" value="tout" checked> Tout exporter — pour une sauvegarde</label>` +
      `<label><input type="radio" name="vivants" value="masquer"> Masquer leurs détails — seuls le nom et les liens restent</label>` +
      `<label><input type="radio" name="vivants" value="exclure"> Les retirer complètement</label></div></div>` +
      `<div class="radios" style="flex-direction:column;gap:6px;margin-top:10px">` +
      `<label><input type="checkbox" name="coordonnees" checked> E-mails et adresses</label>` +
      `<label><input type="checkbox" name="notes" checked> Notes et sources</label>` +
      `<label><input type="checkbox" name="photos" checked> Photos (références dans le GEDCOM, et fichiers dans le .zip)</label></div></form>` +
      `<section class="card"><h3>Télécharger</h3><div class="fiche-actions" style="margin-top:0">` +
      `<button class="btn primary" type="button" data-ex="ged">Fichier GEDCOM (.ged)</button>` +
      `<button class="btn" type="button" data-ex="zip">GEDCOM + photos (.zip)</button></div>` +
      `<p class="vide" id="ex-etat" style="margin:10px 0 0" role="status"></p>` +
      `<p class="vide" style="font-size:13px">Pour partager ou publier l’arbre (Geneanet…), choisissez « Masquer » ou « Retirer » ` +
      `les personnes vivantes et décochez les e-mails et adresses. Pour importer ailleurs avec les photos, prenez le .zip et ` +
      `décompressez-le : le fichier .ged et le dossier photos doivent rester côte à côte.</p></section>`;
    body.querySelector("form").addEventListener("change", majResume);
    body.addEventListener("click", e => {
      const b = e.target.closest("[data-ex]");
      if (b) exporter(b.dataset.ex === "zip");
    });
  }
  function montrer() {
    if (!construit) { construit = true; construire(); }
    majResume();
  }
  function invalider() { if (construit && !$("#expage").hidden) majResume(); }
  return { montrer, invalider };
})();
