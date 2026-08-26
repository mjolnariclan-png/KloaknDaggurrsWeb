const KD = (() => {
  let data = null;
  const app = document.querySelector("#app");
  const $=(s,p=document)=>p.querySelector(s), $$=(s,p=document)=>[...p.querySelectorAll(s)];
  const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  const live=item=>!!item?.revealed||item?.status==="open"||!!(item?.reveal_at&&new Date(item.reveal_at).getTime()<=Date.now());
  const faction=slug=>data?.factions.find(f=>f.slug===slug);
  const route=()=>location.hash.replace(/^#\/?/,"").split("/").filter(Boolean);
  const owned=()=>{try{return JSON.parse(localStorage.getItem("kd-collection")||"{}")}catch{return{}}};
  const saveOwned=m=>localStorage.setItem("kd-collection",JSON.stringify(m));
  const countdown=item=>item?.reveal_at&&!live(item)?`<div class="countdown" data-countdown="${esc(item.reveal_at)}">SIGNAL PENDING</div>`:"";

  async function loadData(){
    if(data) return data;
    const r=await fetch("assets/data/site-data.json",{cache:"no-store"});
    if(!r.ok) throw new Error(`site-data.json returned ${r.status}`);
    data=await r.json();
    return data;
  }

  function factionCard(f,i){
    const open=live(f);
    return `<a class="faction-tile reveal ${open?"":"locked"}" style="--accent:${esc(f.accent||"#7d43ff")}" href="#/faction/${encodeURIComponent(f.slug)}">
      <span class="tile-index">FACTION ${String(i+1).padStart(2,"0")}</span><div class="sigil">${esc(f.rune)}</div>
      <h3>${esc(open?f.name:"CLASSIFIED")}</h3><p>${esc(f.tagline)}</p>${countdown(f)}
      <span class="clearance">${open?"ARCHIVE OPEN":"CLEARANCE DENIED"}</span></a>`;
  }

  function gameCard(c){
    const open=live(c), f=faction(c.faction);
    return `<a class="game-card rarity-${esc(c.rarity.toLowerCase())} ${open?"":"classified-card"} reveal" href="#/card/${encodeURIComponent(c.slug)}">
      <div class="foil"></div><div class="card-top"><span>#${String(c.number).padStart(3,"0")}</span><span>${esc(c.rarity)}</span></div>
      <div class="card-art"><img src="${esc(c.image||"assets/img/card-back.svg")}" alt=""></div>
      <div class="card-copy"><span>${esc(f?.name||"UNKNOWN")}</span><h3>${esc(open?c.name:"██████████")}</h3><small>${esc(c.type)}</small>${countdown(c)}</div></a>`;
  }

  function whisper(w){
    return `<article class="timeline-entry reveal"><time>${esc(w.date)}</time><div><span class="micro">${w.classified?"PARTIALLY REDACTED":"VERIFIED TRANSMISSION"}</span><h2>${esc(w.title)}</h2><p>${esc(w.body)}</p></div></article>`;
  }

  function home(){
    return `
    ${data.site.intro&&!localStorage.getItem("kd-intro-v4")?`<div id="intro" class="intro-sequence"><img src="assets/img/brand-mark.svg" alt=""><p>SIGNAL ACQUIRED</p><h2>KLOAK &amp; DAGGURRS</h2><span>CLICK / TAP TO ENTER</span></div>`:""}
    <section class="hero"><div class="hero-grid"></div><div class="hero-sigil"><img src="assets/img/brand-mark.svg" alt=""></div><div class="hero-copy reveal"><p class="eyebrow">${esc(data.site.eyebrow)}</p><h1>${esc(data.site.title)}</h1><p class="hero-line">${esc(data.site.line1)}<br><strong>${esc(data.site.line2)}</strong></p><div class="hero-actions"><a class="btn primary" href="#world">Enter the Shadows</a><a class="btn ghost" href="#/learn">Learn Klandestine</a></div></div><div class="scroll-cue">DESCEND ↓</div></section>
    <section class="section" id="world"><div class="section-heading"><p class="eyebrow">THE GAME BENEATH THE GAME</p><h2>Trust is a weapon.</h2><p>Klandestine is a social strategy card game of hidden allegiance, calculated deception, and thirteen factions fighting beneath the Veil.</p></div><div class="stat-grid"><article class="stat-card"><b>3–6</b><span>Players</span></article><article class="stat-card"><b>13</b><span>Factions</span></article><article class="stat-card"><b>∞</b><span>Lies Available</span></article><article class="stat-card"><b>1</b><span>Winning Allegiance</span></article></div></section>
    <section class="section"><div class="section-heading split-heading"><div><p class="eyebrow">CHOOSE YOUR ALLEGIANCE</p><h2>Thirteen factions.<br>Very few truths.</h2></div><a class="text-link" href="#/factions">Open faction archive →</a></div><div class="faction-grid">${data.factions.slice(0,8).map(factionCard).join("")}</div></section>
    <section class="section"><div class="section-heading split-heading"><div><p class="eyebrow">THE HOARD</p><h2>Every card leaves evidence.</h2></div><a class="text-link" href="#/cards">Enter Card Archive →</a></div><div class="card-grid">${data.cards.slice(0,6).map(gameCard).join("")}</div></section>
    <section class="section vault-tease"><div class="vault-door"><div class="vault-core"><span>K&amp;D ARCHIVE</span><strong>THE VAULT</strong><small>ACCESS VARIES</small></div></div><div class="vault-copy"><p class="eyebrow">FORBIDDEN KNOWLEDGE</p><h2>Some files should stay closed.</h2><p>Signals, redactions, reveal timers and game codes hidden behind the Veil.</p><a class="btn primary" href="#/vault">Request Vault Access</a></div></section>
    <section class="section"><div class="section-heading"><p class="eyebrow">INTERCEPTED TRANSMISSIONS</p><h2>Whispers beyond the Veil.</h2></div><div class="timeline">${data.whispers.filter(w=>!w.reveal_at||new Date(w.reveal_at)<=new Date()).slice(0,3).map(whisper).join("")}</div></section>`;
  }

  function factionsPage(){
    return `<section class="page-hero"><p class="eyebrow">THE THIRTEEN</p><h1>FACTIONS</h1><p>Allegiances are chosen. Motives are hidden. Victory belongs to those who understand both.</p></section><section class="section"><div class="faction-grid">${data.factions.map(factionCard).join("")}</div></section>`;
  }

  function factionPage(slug){
    const f=faction(slug); if(!f) return notFound("FACTION RECORD");
    const open=live(f),cards=data.cards.filter(c=>c.faction===slug);
    return `<section class="faction-hero" style="--accent:${esc(f.accent)}"><div class="faction-emblem">${esc(f.rune)}</div><div><p class="eyebrow">${open?"FACTION ARCHIVE":"CLEARANCE DENIED"}</p><h1>${esc(open?f.name:"CLASSIFIED")}</h1><p>${esc(f.tagline)}</p>${countdown(f)}</div></section>
    <section class="section faction-lore">${open?`<div class="lore-copy"><p class="eyebrow">ARCHIVE ENTRY</p><h2>The doctrine</h2><p>${esc(f.lore)}</p><blockquote>${esc(f.doctrine)}</blockquote></div><div class="dossier"><span>STATUS</span><strong>REVEALED</strong><span>RECORD</span><strong>${esc(f.slug.toUpperCase())}</strong></div>`:`<div class="classified-block"><h2>FILE SEALED</h2><p>The archive has detected this faction, but public clearance has not yet been granted.</p></div>`}</section>
    ${open&&cards.length?`<section class="section"><div class="section-heading"><p class="eyebrow">KNOWN ASSETS</p><h2>${esc(f.name)} cards.</h2></div><div class="card-grid">${cards.map(gameCard).join("")}</div></section>`:""}`;
  }

  function cardsPage(){
    return `<section class="page-hero"><p class="eyebrow">KLANDESTINE CARD ARCHIVE</p><h1>THE HOARD</h1><p>Catalogued assets, revealed cards, and empty spaces where secrets are still hiding.</p></section>
    <section class="section"><form id="card-filters" class="archive-filters"><select id="filter-faction"><option value="">All factions</option>${data.factions.map(f=>`<option value="${esc(f.slug)}">${esc(f.name)}</option>`).join("")}</select><select id="filter-rarity"><option value="">All rarities</option>${[...new Set(data.cards.map(c=>c.rarity))].map(v=>`<option>${esc(v)}</option>`).join("")}</select><select id="filter-type"><option value="">All types</option>${[...new Set(data.cards.map(c=>c.type))].map(v=>`<option>${esc(v)}</option>`).join("")}</select><button class="btn ghost">Filter Archive</button><button type="button" id="reset-filters" class="btn ghost">Reset</button></form><div id="cards-result" class="card-grid archive-grid">${data.cards.map(gameCard).join("")}</div></section>`;
  }

  function cardPage(slug){
    const c=data.cards.find(x=>x.slug===slug); if(!c) return notFound("CARD DOSSIER");
    const open=live(c),f=faction(c.faction),qty=owned()[slug]||0;
    return `<section class="card-dossier"><div><div class="game-card giant rarity-${esc(c.rarity.toLowerCase())} ${open?"":"classified-card"}"><div class="foil"></div><div class="card-top"><span>#${String(c.number).padStart(3,"0")}</span><span>${esc(c.rarity)}</span></div><div class="card-art"><img src="${esc(c.image)}" alt=""></div><div class="card-copy"><span>${esc(f?.name||"UNKNOWN")}</span><h2>${esc(open?c.name:"CLASSIFIED")}</h2><small>${esc(c.type)}</small></div></div></div><div class="card-record"><p class="eyebrow">CARD DOSSIER / #${String(c.number).padStart(3,"0")}</p><h1>${esc(open?c.name:"██████████")}</h1>${open?`<div class="record-grid"><span>Faction</span><b>${esc(f?.name||"Unknown")}</b><span>Rarity</span><b>${esc(c.rarity)}</b><span>Type</span><b>${esc(c.type)}</b></div><h3>ABILITY</h3><p>${esc(c.ability)}</p><h3>LORE</h3><p>${esc(c.lore)}</p><form id="collection-form" class="collection-form"><label>Copies in My Archive <input id="collection-qty" type="number" min="0" max="99" value="${qty}"></label><button class="btn primary">Update Collection</button></form>`:countdown(c)}</div></section>`;
  }

  function vaultPage(){
    const unlocked=new Set(JSON.parse(localStorage.getItem("kd-vault-unlocked")||"[]"));
    const files=data.vault.map(v=>{const open=live(v)||unlocked.has(v.code);return `<article class="vault-file ${open?"":"locked"}"><div class="file-top"><span>${esc(v.code)}</span><b>${open?"ACCESS GRANTED":"🔒 CLASSIFIED"}</b></div><h2>${esc(open?v.title:"████████████")}</h2><p>${esc(v.teaser)}</p>${open?`<div class="file-body">${esc(v.body)}</div>`:`<div class="redactions"><i></i><i></i><i></i></div>${countdown(v)}`}</article>`}).join("");
    return `<section class="page-hero"><p class="eyebrow">AUTHORIZED EYES ONLY</p><h1>THE VAULT</h1><p>Forbidden knowledge. Handle with care.</p></section><section class="section terminal-wrap"><div class="terminal"><div class="terminal-bar">K&amp;D ARCHIVE NETWORK // PUBLIC NODE</div><pre>&gt; SIGNAL: STABLE
&gt; FILES DETECTED: ${data.vault.length}
&gt; CODE INPUT: READY_</pre><form id="vault-code-form"><input id="vault-code" autocomplete="off" placeholder="ENTER VAULT CODE"><button class="btn primary">UNLOCK</button></form><p id="vault-message"></p></div></section><section class="section"><div id="vault-grid" class="vault-grid">${files}</div></section>`;
  }

  function whispersPage(){
    const rows=data.whispers.filter(w=>!w.reveal_at||new Date(w.reveal_at)<=new Date());
    return `<section class="page-hero"><p class="eyebrow">SIGNALS / RUMORS / FRAGMENTS</p><h1>WHISPERS</h1><p>The official record is incomplete. That does not mean nothing happened.</p></section><section class="section narrow"><div class="timeline">${rows.map(whisper).join("")}</div></section>`;
  }

  function learnPage(){
    return `<section class="page-hero"><p class="eyebrow">FIELD MANUAL 01</p><h1>LEARN KLANDESTINE</h1><p>Know the rules. Hide your allegiance. Never assume the table is telling you the truth.</p></section><section class="section"><div class="rule-steps"><article class="rule-card"><span>01</span><h2>DRAW</h2><p>Build options before the table understands what you are holding.</p></article><article class="rule-card"><span>02</span><h2>DECEIVE</h2><p>Use Kloaks and hidden information to make certainty impossible.</p></article><article class="rule-card"><span>03</span><h2>MANEUVER</h2><p>Attack, bargain, pressure, or let someone else do the damage.</p></article><article class="rule-card"><span>04</span><h2>FULFILL</h2><p>Every faction wants something. Win before the table learns exactly what.</p></article></div></section><section class="section manual-copy"><h2>Setup</h2><p>Klandestine begins with hidden allegiance. Prepare the deck, establish the players, distribute required faction information, and keep private information private.</p><h2>Kloaks</h2><p>Kloaks preserve uncertainty. Bluff, protect intent, create false narratives, and force opponents to decide without complete information.</p><h2>Victory</h2><p>Victory is faction-dependent. Everyone is trying to win. Nobody is required to tell you how.</p></section>`;
  }

  function forgePage(){
    return `<section class="page-hero"><p class="eyebrow">CUSTOM 3D PRINTING</p><h1>THE FORGE</h1><p>Ideas enter as files. They leave as objects.</p><div class="hero-actions"><a class="btn primary" href="#/forge-order">Build a Request</a><a class="btn ghost" href="#/gallery">Gallery</a></div></section><section class="section service-grid"><article class="service-card"><span>01</span><h2>Transmit</h2><p>Send a model link or describe the build.</p></article><article class="service-card"><span>02</span><h2>Configure</h2><p>Color, quantity, deadline and special requirements.</p></article><article class="service-card"><span>03</span><h2>Forge</h2><p>The GitHub edition builds a complete email-ready mission brief.</p></article></section>`;
  }

  function forgeOrderPage(){
    return `<section class="page-hero compact"><p class="eyebrow">FORGE REQUEST</p><h1>BUILD SOMETHING REAL.</h1><p>Create the mission brief and send it through your configured Forge email.</p></section><section class="section form-section"><form id="forge-form" class="kd-form"><div class="form-grid"><label>Name<input id="fo-name" required></label><label>Email<input id="fo-email" type="email" required></label><label>Phone<input id="fo-phone"></label><label>Print Type<select id="fo-type"><option>FDM</option><option>Resin</option><option>Not sure</option></select></label><label>Quantity<input id="fo-qty" type="number" min="1" value="1"></label><label>Deadline<input id="fo-deadline" type="date"></label></div><label>Model / source link<input id="fo-link"></label><label>Colors<input id="fo-colors"></label><label>Build brief<textarea id="fo-notes" rows="7"></textarea></label><button class="btn primary">Prepare Forge Request</button></form><div id="forge-output" class="request-output" hidden></div></section>`;
  }

  function galleryPage(){
    const html=data.gallery.length?data.gallery.map(g=>`<figure class="gallery-item"><img src="${esc(g.image)}" alt="${esc(g.alt||g.title||"")}"><figcaption>${esc(g.title||"")}</figcaption></figure>`).join(""):`<div class="empty-panel"><h2>The Gallery is ready.</h2><p>Add images to the repository and entries to the gallery array in <code>site-data.json</code>.</p></div>`;
    return `<section class="page-hero"><p class="eyebrow">BUILT IN THE FORGE</p><h1>GALLERY</h1><p>Customer builds and creations.</p></section><section class="section"><div class="gallery-grid">${html}</div></section>`;
  }

  function contactPage(){
    return `<section class="page-hero compact"><p class="eyebrow">OPEN CHANNEL</p><h1>CONTACT</h1><p>Prepare a transmission to Kloak &amp; Daggurrs.</p></section><section class="section form-section"><form id="contact-form" class="kd-form"><div class="form-grid"><label>Name<input id="ct-name" required></label><label>Email<input id="ct-email" type="email" required></label></div><label>Subject<input id="ct-subject" required></label><label>Message<textarea id="ct-message" rows="8" required></textarea></label><button class="btn primary">Prepare Transmission</button></form><div id="contact-output" class="request-output" hidden></div></section>`;
  }

  function accountPage(){
    const map=owned(),rows=data.cards.filter(c=>map[c.slug]>0),revealed=data.cards.filter(live).length;
    return `<section class="page-hero compact"><p class="eyebrow">LOCAL PLAYER ARCHIVE</p><h1>MY ARCHIVE</h1><p>Your card collection is stored privately in this browser on this device.</p></section><section class="section"><div class="archive-progress"><span>CARDS LOGGED</span> <b>${rows.length}</b> <small>of ${revealed} currently revealed</small><div class="progress-meter"><i style="width:${Math.round(rows.length/Math.max(1,revealed)*100)}%"></i></div></div><div class="collection-grid">${rows.length?rows.map(c=>`<a class="collection-item" href="#/card/${encodeURIComponent(c.slug)}"><span>#${String(c.number).padStart(3,"0")}</span><h3>${esc(c.name)}</h3><p>${esc(faction(c.faction)?.name||"Unknown")} · ${esc(c.rarity)}</p><b>×${map[c.slug]}</b></a>`).join(""):`<div class="empty-panel"><h2>Your archive is empty.</h2><p>Enter The Hoard and log cards you own.</p><a class="btn primary" href="#/cards">Enter The Hoard</a></div>`}</div></section>`;
  }

  function studioPage(){
    return `<section class="page-hero compact"><p class="eyebrow">GITHUB CONTENT STUDIO</p><h1>CONTENT STUDIO</h1><p>Edit the site's data, export the replacement JSON, commit, and push.</p></section><section class="section"><div class="studio-grid"><div class="admin-card"><h2>site-data.json</h2><textarea id="studio-json" spellcheck="false">${esc(JSON.stringify(data,null,2))}</textarea><div class="hero-actions left"><button id="studio-format" class="btn ghost">Format</button><button id="studio-download" class="btn primary">Download JSON</button></div></div><div class="admin-card"><h2>Publish</h2><p>Replace <code>assets/data/site-data.json</code> with the downloaded file.</p><p>Then:</p><pre>git add .
git commit -m "Update K&D content"
git push origin main</pre><p class="warning">This studio is a convenience editor, not a secure admin login. GitHub Pages is static hosting.</p></div></div></section>`;
  }

  function notFound(label="SIGNAL"){
    return `<section class="page-hero"><p class="eyebrow">404 / ${esc(label)} LOST</p><h1>BEHIND THE VEIL.</h1><p>This record does not exist.</p><a class="btn primary" href="#/">Return Home</a></section>`;
  }

  function bind(){
    const intro=$("#intro"); if(intro){document.body.classList.add("intro-locked");intro.addEventListener("click",()=>{localStorage.setItem("kd-intro-v4","1");intro.classList.add("leave");document.body.classList.remove("intro-locked");setTimeout(()=>intro.remove(),800)})}
    $("#card-filters")?.addEventListener("submit",e=>{e.preventDefault();const f=$("#filter-faction").value,r=$("#filter-rarity").value,t=$("#filter-type").value,rows=data.cards.filter(c=>(!f||c.faction===f)&&(!r||c.rarity===r)&&(!t||c.type===t));$("#cards-result").innerHTML=rows.map(gameCard).join("");enhance()});
    $("#reset-filters")?.addEventListener("click",()=>{["#filter-faction","#filter-rarity","#filter-type"].forEach(s=>$(s).value="");$("#cards-result").innerHTML=data.cards.map(gameCard).join("");enhance()});
    $("#collection-form")?.addEventListener("submit",e=>{e.preventDefault();const slug=route()[1],q=Math.max(0,Math.min(99,parseInt($("#collection-qty").value)||0)),m=owned();if(q)m[slug]=q;else delete m[slug];saveOwned(m);alert("My Archive updated on this device.")});
    $("#vault-code-form")?.addEventListener("submit",e=>{e.preventDefault();const code=$("#vault-code").value.trim().toUpperCase(),v=data.vault.find(x=>x.access_code&&x.access_code.toUpperCase()===code);if(!v){$("#vault-message").textContent="CODE REJECTED";return}const unlocked=new Set(JSON.parse(localStorage.getItem("kd-vault-unlocked")||"[]"));unlocked.add(v.code);localStorage.setItem("kd-vault-unlocked",JSON.stringify([...unlocked]));$("#vault-message").textContent=`${v.code} UNLOCKED`;setTimeout(render,350)});
    $("#forge-form")?.addEventListener("submit",e=>{e.preventDefault();const body=`KLOAK & DAGGURRS — FORGE REQUEST\n\nName: ${$("#fo-name").value}\nEmail: ${$("#fo-email").value}\nPhone: ${$("#fo-phone").value}\nPrint Type: ${$("#fo-type").value}\nQuantity: ${$("#fo-qty").value}\nDeadline: ${$("#fo-deadline").value}\nSource: ${$("#fo-link").value}\nColors: ${$("#fo-colors").value}\n\nBuild Brief:\n${$("#fo-notes").value}`;const out=$("#forge-output");out.hidden=false;out.innerHTML=`<h2>Forge Request Ready</h2><pre>${esc(body)}</pre><div class="hero-actions left"><button id="copy-forge" class="btn ghost">Copy Request</button>${KD_CONFIG.forgeEmail?`<a class="btn primary" href="mailto:${encodeURIComponent(KD_CONFIG.forgeEmail)}?subject=${encodeURIComponent("K&D Forge Request")}&body=${encodeURIComponent(body)}">Open Email</a>`:`<p class="warning">Add forgeEmail in assets/js/config.js to enable one-click email.</p>`}</div>`;$("#copy-forge").addEventListener("click",()=>navigator.clipboard.writeText(body))});
    $("#contact-form")?.addEventListener("submit",e=>{e.preventDefault();const body=`Name: ${$("#ct-name").value}\nEmail: ${$("#ct-email").value}\n\n${$("#ct-message").value}`,sub=$("#ct-subject").value,out=$("#contact-output");out.hidden=false;out.innerHTML=`<h2>Transmission Ready</h2><pre>${esc(body)}</pre><div class="hero-actions left"><button id="copy-contact" class="btn ghost">Copy Message</button>${KD_CONFIG.contactEmail?`<a class="btn primary" href="mailto:${encodeURIComponent(KD_CONFIG.contactEmail)}?subject=${encodeURIComponent(sub)}&body=${encodeURIComponent(body)}">Open Email</a>`:`<p class="warning">Add contactEmail in assets/js/config.js to enable one-click email.</p>`}</div>`;$("#copy-contact").addEventListener("click",()=>navigator.clipboard.writeText(body))});
    $("#studio-format")?.addEventListener("click",()=>{try{$("#studio-json").value=JSON.stringify(JSON.parse($("#studio-json").value),null,2)}catch(e){alert(e.message)}});
    $("#studio-download")?.addEventListener("click",()=>{try{const o=JSON.parse($("#studio-json").value),blob=new Blob([JSON.stringify(o,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="site-data.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}catch(e){alert(e.message)}});
  }

  function enhance(){
    if("IntersectionObserver" in window&&!matchMedia("(prefers-reduced-motion: reduce)").matches){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("visible");io.unobserve(e.target)}}),{threshold:.08});$$(".reveal").forEach(x=>io.observe(x));}else $$(".reveal").forEach(x=>x.classList.add("visible"));
    $$(".game-card,.faction-tile,.stat-card").forEach(card=>{card.addEventListener("pointermove",e=>{if(innerWidth<850)return;const r=card.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;card.style.setProperty("--rx",`${y*-7}deg`);card.style.setProperty("--ry",`${x*9}deg`);card.style.setProperty("--mx",`${(e.clientX-r.left)/r.width*100}%`);card.style.setProperty("--my",`${(e.clientY-r.top)/r.height*100}%`)});card.addEventListener("pointerleave",()=>{card.style.removeProperty("--rx");card.style.removeProperty("--ry")})});
    const cds=$$("[data-countdown]");if(cds.length){const tick=()=>cds.forEach(el=>{let d=new Date(el.dataset.countdown).getTime()-Date.now();if(d<=0){el.textContent="THE VEIL HAS LIFTED";return}const days=Math.floor(d/86400000);d%=86400000;const h=Math.floor(d/3600000);d%=3600000;const m=Math.floor(d/60000),s=Math.floor((d%60000)/1000);el.textContent=`${days}D ${String(h).padStart(2,"0")}H ${String(m).padStart(2,"0")}M ${String(s).padStart(2,"0")}S`});tick();setTimeout(tick,1000)}
  }

  async function render(){
    await loadData();
    const [p,arg]=route();
    document.title="Kloak & Daggurrs — Klandestine";
    if(!p) app.innerHTML=home();
    else if(p==="factions") app.innerHTML=factionsPage();
    else if(p==="faction") app.innerHTML=factionPage(arg);
    else if(p==="cards") app.innerHTML=cardsPage();
    else if(p==="card") app.innerHTML=cardPage(arg);
    else if(p==="vault") app.innerHTML=vaultPage();
    else if(p==="whispers") app.innerHTML=whispersPage();
    else if(p==="learn") app.innerHTML=learnPage();
    else if(p==="forge") app.innerHTML=forgePage();
    else if(p==="forge-order") app.innerHTML=forgeOrderPage();
    else if(p==="gallery") app.innerHTML=galleryPage();
    else if(p==="contact") app.innerHTML=contactPage();
    else if(p==="account") app.innerHTML=accountPage();
    else if(p==="studio") app.innerHTML=studioPage();
    else app.innerHTML=notFound();
    scrollTo({top:0,behavior:"instant"}); bind(); enhance();
  }

  document.querySelector("[data-year]").textContent=new Date().getFullYear();
  const header=$("#site-header");addEventListener("scroll",()=>header.classList.toggle("scrolled",scrollY>25),{passive:true});
  const toggle=$(".nav-toggle"),nav=$(".main-nav");toggle.addEventListener("click",()=>{const o=toggle.getAttribute("aria-expanded")==="true";toggle.setAttribute("aria-expanded",String(!o));nav.classList.toggle("open",!o)});$$("a",nav).forEach(a=>a.addEventListener("click",()=>nav.classList.remove("open")));
  addEventListener("pointermove",e=>{const g=$(".cursor-glow");g.style.left=e.clientX+"px";g.style.top=e.clientY+"px"},{passive:true});
  addEventListener("hashchange",render);
  render().catch(e=>{console.error(e);app.innerHTML=`<div class="fatal">K&D content failed to load: ${esc(e.message)}</div>`});
})();
