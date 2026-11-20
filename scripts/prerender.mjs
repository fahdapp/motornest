// MotorNest page builder.
// Runs on Render before each deploy: reads live stock from Supabase and writes a real HTML page
// for every car (/cars/<slug>/), every dealer (/dealers/<slug>/), an all-cars page (/cars/),
// plus sitemap.xml and robots.txt, so Google can find and index each car.
// Each page is the full MotorNest app with the car already written into it, so visitors get the normal site.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const SITE = "https://motornest.iconic1.co.uk";
const SB_URL = "https://ixagimjtfkldxzmmtqfj.supabase.co";
const SB_KEY = "sb_publishable_pi0CK3HTSJmcrSg_EAG6ag_n6LwGHp5";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "£" + Number(n || 0).toLocaleString("en-GB");
const num = (n) => Number(n || 0).toLocaleString("en-GB");
const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const photoUrl = (p) => /^https:\/\//i.test(p) ? p : `${SB_URL}/storage/v1/object/public/car-photos/${String(p).split("/").map(encodeURIComponent).join("/")}`;
const titleOf = (c) => [c.year, c.make, c.model].filter(Boolean).join(" ");
export const carSlug = (c) => slugify([c.year, c.make, c.model, c.variant].filter(Boolean).join(" ")).slice(0, 70).replace(/-+$/, "") + "-" + c.id.slice(0, 8);

async function getAll(path) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const rows = await r.json(); out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

function page(tpl, { title, description, canonical, image, jsonld, body, route }) {
  const head = `<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="MotorNest">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : ""}
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}
${route ? `<script>window.MN_ROUTE=${JSON.stringify(route)};</script>` : ""}`;
  return tpl
    .replace(/<title>[\s\S]*?<\/title>/, head)
    .replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${body}</main>`);
}

function carCard(c) {
  const p = c.photos[0];
  return `<a class="card" href="/cars/${c.slug}/"><div class="pic">${p ? `<img loading="lazy" alt="${esc(titleOf(c))}" src="${esc(photoUrl(p.path))}">` : ""}</div>` +
    `<div class="body"><h3>${esc(titleOf(c))}</h3><p>${esc(c.variant || "")}</p><b>${money(c.price)}</b>` +
    `<p>${[c.mileage != null ? num(c.mileage) + " miles" : "", c.fuel, c.gearbox, c.dealer.town].filter(Boolean).map(esc).join(" · ")}</p></div></a>`;
}

async function main() {
  const tpl = readFileSync("index.html", "utf8");
  const cars = (await getAll("cars?select=id,reg,make,model,variant,year,price,mileage,fuel,gearbox,body_type,colour,engine_cc,doors,seats,owners,mot_expiry,description,updated_at,dealer:dealers!cars_dealer_id_fkey(id,name,slug,town,postcode,phone,address,status),photos:car_photos!car_photos_car_id_fkey(path,sort_order)&status=eq.live&order=created_at.desc"))
    .filter((c) => c.dealer && c.dealer.status === "approved" && c.price > 0);
  for (const c of cars) { c.photos.sort((a, b) => a.sort_order - b.sort_order); c.slug = carSlug(c); }
  const dealers = new Map();
  for (const c of cars) { if (!dealers.has(c.dealer.slug)) dealers.set(c.dealer.slug, { ...c.dealer, cars: [] }); dealers.get(c.dealer.slug).cars.push(c); }
  console.log(`MotorNest pages: ${cars.length} cars from ${dealers.size} dealers`);

  rmSync("cars", { recursive: true, force: true }); rmSync("dealers", { recursive: true, force: true });
  const today = new Date().toISOString().slice(0, 10);
  const urls = [{ loc: `${SITE}/`, lastmod: today }, { loc: `${SITE}/cars/`, lastmod: today }];

  for (const c of cars) {
    const d = c.dealer, t = titleOf(c), url = `${SITE}/cars/${c.slug}/`;
    const where = [d.town || "Sheffield", d.postcode].filter(Boolean).join(", ");
    const facts = [c.mileage != null ? num(c.mileage) + " miles" : "", c.fuel, c.gearbox, c.body_type, c.colour].filter(Boolean);
    const description = `${t} ${c.variant || ""} for sale at ${d.name}, ${d.town || "Sheffield"}: ${money(c.price)}${facts.length ? ", " + facts.slice(0, 3).join(", ") : ""}. See photos and contact the dealer on MotorNest.`.replace(/\s+/g, " ");
    const spec = (l, v) => v == null || v === "" ? "" : `<div><dt>${l}</dt><dd>${esc(v)}</dd></div>`;
    const body = `<div class="wrap"><nav class="crumb"><a href="/">MotorNest</a> › <a href="/cars/">Used cars</a> › <a href="/dealers/${esc(d.slug)}/">${esc(d.name)}</a></nav>
<div class="detail"><div>${c.photos[0] ? `<div class="gal"><img class="main" alt="${esc(t)}" src="${esc(photoUrl(c.photos[0].path))}"></div>` : ""}
<div class="titleblock"><h1>${esc(t)}</h1>${c.variant ? `<div class="v">${esc(c.variant)}</div>` : ""}<div class="mprice"><span class="p">${money(c.price)}</span></div>
<div class="keyfacts">${facts.map((f) => `<span>${esc(f)}</span>`).join("")}</div></div>
<dl class="specgrid">${spec("Year", c.year)}${spec("Body style", c.body_type)}${spec("Colour", c.colour)}${spec("Engine", c.engine_cc ? (c.engine_cc / 1000).toFixed(1) + " litre" : null)}${spec("Doors", c.doors)}${spec("Seats", c.seats)}${spec("Previous owners", c.owners)}</dl>
${c.description ? `<div class="about"><h2>About this car</h2><p>${esc(c.description)}</p></div>` : ""}</div>
<aside class="side"><div class="pricecard"><div class="p">${money(c.price)}</div><p>For sale at <a href="/dealers/${esc(d.slug)}/"><b>${esc(d.name)}</b></a>, ${esc(where)}${d.phone ? `. Call ${esc(d.phone)}` : ""}.</p></div></aside></div></div>`;
    const jsonld = {
      "@context": "https://schema.org", "@type": "Car", name: `${t} ${c.variant || ""}`.trim(), url,
      brand: { "@type": "Brand", name: c.make }, model: c.model, vehicleConfiguration: c.variant || undefined,
      vehicleModelDate: c.year ? String(c.year) : undefined, bodyType: c.body_type || undefined, color: c.colour || undefined,
      fuelType: c.fuel || undefined, vehicleTransmission: c.gearbox || undefined, numberOfDoors: c.doors || undefined,
      mileageFromOdometer: c.mileage != null ? { "@type": "QuantitativeValue", value: c.mileage, unitCode: "SMI" } : undefined,
      image: c.photos.slice(0, 6).map((p) => photoUrl(p.path)), description: c.description || description,
      offers: { "@type": "Offer", price: c.price, priceCurrency: "GBP", availability: "https://schema.org/InStock", itemCondition: "https://schema.org/UsedCondition", url,
        seller: { "@type": "AutoDealer", name: d.name, telephone: d.phone || undefined, address: { "@type": "PostalAddress", streetAddress: d.address || undefined, addressLocality: d.town || undefined, postalCode: d.postcode || undefined, addressCountry: "GB" } } },
    };
    mkdirSync(`cars/${c.slug}`, { recursive: true });
    writeFileSync(`cars/${c.slug}/index.html`, page(tpl, { title: `${t} for sale in ${d.town || "Sheffield"} | ${money(c.price)} | MotorNest`, description, canonical: url, image: c.photos[0] ? photoUrl(c.photos[0].path) : null, jsonld, body, route: `#/car/${c.id}` }));
    urls.push({ loc: url, lastmod: String(c.updated_at || today).slice(0, 10) });
  }

  for (const d of dealers.values()) {
    const url = `${SITE}/dealers/${d.slug}/`;
    const body = `<div class="wrap"><nav class="crumb"><a href="/">MotorNest</a> › <a href="/cars/">Used cars</a></nav><h1>${esc(d.name)}</h1>
<p>${esc([d.address, d.town, d.postcode].filter(Boolean).join(", "))}${d.phone ? ` · ${esc(d.phone)}` : ""}</p><h2>${d.cars.length} used cars for sale</h2><div class="cards">${d.cars.map(carCard).join("")}</div></div>`;
    const jsonld = { "@context": "https://schema.org", "@type": "AutoDealer", name: d.name, url, telephone: d.phone || undefined, address: { "@type": "PostalAddress", streetAddress: d.address || undefined, addressLocality: d.town || undefined, postalCode: d.postcode || undefined, addressCountry: "GB" } };
    mkdirSync(`dealers/${d.slug}`, { recursive: true });
    writeFileSync(`dealers/${d.slug}/index.html`, page(tpl, { title: `${d.name} | ${d.cars.length} used cars for sale in ${d.town || "Sheffield"} | MotorNest`, description: `Browse ${d.cars.length} used cars for sale at ${d.name} in ${d.town || "Sheffield"}. Photos, prices and contact details on MotorNest.`, canonical: url, image: d.cars[0] && d.cars[0].photos[0] ? photoUrl(d.cars[0].photos[0].path) : null, jsonld, body, route: `#/dealer/${d.slug}` }));
    urls.push({ loc: url, lastmod: today });
  }

  const all = `<div class="wrap"><h1>Used cars for sale in Sheffield and South Yorkshire</h1><p>${cars.length} used cars from ${dealers.size} local dealers: ${[...dealers.values()].map((d) => `<a href="/dealers/${esc(d.slug)}/">${esc(d.name)}</a>`).join(", ")}.</p><div class="cards">${cars.map(carCard).join("")}</div></div>`;
  mkdirSync("cars", { recursive: true });
  writeFileSync("cars/index.html", page(tpl, { title: `${cars.length} used cars for sale in Sheffield | MotorNest`, description: `Browse ${cars.length} used cars from ${dealers.size} trusted Sheffield and South Yorkshire dealers on MotorNest.`, canonical: `${SITE}/cars/`, body: all, route: "#/" }));

  // privacy policy and terms: real pages for Google, built from the same text the app shows
  for (const [kind, name, desc] of [["privacy", "Privacy policy", "How MotorNest collects and uses personal information, and your rights."], ["terms", "Terms of use", "The terms for using MotorNest, for car buyers and dealers."]]) {
    const m = tpl.match(new RegExp(`<template id="legal-${kind}">([\\s\\S]*?)</template>`));
    if (!m) continue;
    mkdirSync(kind, { recursive: true });
    writeFileSync(`${kind}/index.html`, page(tpl, { title: `${name} | MotorNest`, description: desc, canonical: `${SITE}/${kind}/`, body: `<div class="wrap"><article class="legal">${m[1]}</article></div>`, route: `#/${kind}` }));
    urls.push({ loc: `${SITE}/${kind}/`, lastmod: today });
  }

  // home page: real description and links to every car, for Google (the app replaces it for visitors)
  const home = page(tpl, { title: "MotorNest | Used cars from trusted Sheffield dealers", description: `${cars.length} used cars for sale from ${dealers.size} trusted Sheffield and South Yorkshire dealers. Search by make, price and distance, then call or message the dealer.`, canonical: `${SITE}/`, body: `<div class="wrap"><h1>Used cars from trusted Sheffield dealers</h1><p><a href="/cars/">Browse all ${cars.length} used cars</a></p><div class="cards">${cars.slice(0, 48).map(carCard).join("")}</div></div>` });
  writeFileSync("index.html", home);

  writeFileSync("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`);
  writeFileSync("robots.txt", `User-agent: *\nAllow: /\nDisallow: /docs/\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`Wrote ${cars.length} car pages, ${dealers.size} dealer pages, sitemap with ${urls.length} links`);
}

main().catch((e) => { console.error("Page builder failed, the site will deploy without fresh car pages:", e); process.exitCode = 0; });
