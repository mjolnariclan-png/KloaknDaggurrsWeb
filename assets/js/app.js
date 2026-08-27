const KD = (() => {
  const app = document.querySelector("#app");
  const $=(s,p=document)=>p.querySelector(s), $$=(s,p=document)=>[...p.querySelectorAll(s)];
  const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  const route=()=>location.hash.replace(/^#\/?/,"").split("/").filter(Boolean);

  const sb = window.supabase?.createClient(
    KD_CONFIG.supabaseUrl,
    KD_CONFIG.supabasePublishableKey,
    {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}
  );

  let fallback=null, data=null, session=null, profile=null, backendOnline=false;

  const isAdmin=()=>profile && ["owner","admin"].includes(profile.role) && profile.active!==false;
  const live=item=>item?.is_live ?? (!!item?.revealed || item?.status==="open" || !!(item?.reveal_at&&new Date(item.reveal_at).getTime()<=Date.now()));
  const faction=slug=>data?.factions.find(f=>f.slug===slug);
  const countdown=item=>item?.reveal_at&&!live(item)?`<div class="countdown" data-countdown="${esc(item.reveal_at)}">SIGNAL PENDING</div>`:"";
  const fmtDate=v=>v?new Date(v).toLocaleString():"—";

  async function loadFallback(){
    if(fallback) return fallback;
    const r=await fetch(KD_CONFIG.fallbackDataFile,{cache:"no-store"});
    if(!r.ok) throw new Error(`Fallback content returned ${r.status}`);
    fallback=await r.json();
    return fallback;
  }

  async function loadAuth(){
    if(!sb) return;
    const {data:{session:s}}=await sb.auth.getSession();
    session=s;
    await loadProfile();
  }

  async function loadProfile(){
    profile=null;
    if(!session?.user) return;
    const {data:p}=await sb.from("profiles").select("*").eq("id",session.user.id).maybeSingle();
    profile=p||null;
  }

  function normalizeFallback(f){
    return {
      site:f.site,
      factions:f.factions.map((x,i)=>({...x,id:null,sort_order:(i+1)*10,is_live:!!x.revealed})),
      cards:f.cards.map((x,i)=>({...x,id:null,card_number:x.number,card_type:x.type,faction_slug:x.faction,image_url:x.image,sort_order:(i+1)*10,is_live:!!x.revealed})),
      whispers:f.whispers.map((x,i)=>({...x,id:null,published_at:x.date,image_url:x.image||null})),
      vault:f.vault.map((x,i)=>({...x,id:null,unlocked:x.status==="open"}))
    };
  }

  async function loadContent(force=false){
    if(data && !force) return data;
    const f=await loadFallback();
    data=normalizeFallback(f);
    if(!sb) return data;

    try{
      const [fr,cr,wr,vr]=await Promise.all([
        sb.from("public_factions").select("*").order("sort_order"),
        sb.from("public_cards").select("*").order("sort_order"),
        sb.from("public_whispers").select("*").order("published_at",{ascending:false}),
        sb.rpc("get_vault_entries")
      ]);
      if(fr.error) throw fr.error;
      if(cr.error) throw cr.error;
      if(wr.error) throw wr.error;
      if(vr.error) throw vr.error;

      data.factions=(fr.data||[]).map(x=>({...x,revealed:x.is_live}));
      data.cards=(cr.data||[]).map(x=>({
        ...x,number:x.card_number,type:x.card_type,faction:x.faction_slug,
        image:x.image_url||"assets/img/card-back.svg",revealed:x.is_live
      }));
      data.whispers=(wr.data||[]).map(x=>({...x,date:x.published_at,image:x.image_url}));
      data.vault=(vr.data||[]).map(x=>({...x,is_live:x.unlocked}));
      backendOnline=true;
    }catch(e){
      console.warn("Supabase content unavailable; using GitHub fallback JSON.",e);
      backendOnline=false;
    }
    return data;
  }

  function updateHeader(){
    const a=$(".nav-account");
    if(!a) return;
    if(session?.user){
      a.textContent=isAdmin()?"Command":"My Archive";
      a.href=isAdmin()?"#/admin":"#/account";
    }else{
      a.textContent="Sign In";
      a.href="#/login";
    }
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
    return `<article class="timeline-entry reveal"><time>${esc(w.published_at||w.date)}</time><div><span class="micro">${w.classified?"PARTIALLY REDACTED":"VERIFIED TRANSMISSION"}</span><h2>${esc(w.title)}</h2><p>${esc(w.body)}</p></div></article>`;
  }

  function backendBadge(){
    return `<div class="backend-badge ${backendOnline?"online":"offline"}">${backendOnline?"● LIVE DATABASE":"● STATIC FALLBACK"}</div>`;
  }

  function home(){
    return `
    ${data.site.intro&&!localStorage.getItem("kd-intro-v4")?`<div id="intro" class="intro-sequence"><img src="assets/img/brand-mark.svg" alt=""><p>SIGNAL ACQUIRED</p><h2>KLOAK &amp; DAGGURRS</h2><span>CLICK / TAP TO ENTER</span></div>`:""}
    <section class="hero"><div class="hero-grid"></div><div class="hero-sigil"><img src="assets/img/brand-mark.svg" alt=""></div><div class="hero-copy reveal"><p class="eyebrow">${esc(data.site.eyebrow)}</p><h1>${esc(data.site.title)}</h1><p class="hero-line">${esc(data.site.line1)}<br><strong>${esc(data.site.line2)}</strong></p><div class="hero-actions"><a class="btn primary" href="#world">Enter the Shadows</a><a class="btn ghost" href="#/learn">Learn Klandestine</a></div></div><div class="scroll-cue">DESCEND ↓</div></section>
    <section class="section" id="world"><div class="section-heading"><p class="eyebrow">THE GAME BENEATH THE GAME</p><h2>Trust is a weapon.</h2><p>Klandestine is a social strategy card game of hidden allegiance, calculated deception, and nine factions fighting beneath the Veil.</p></div><div class="stat-grid"><article class="stat-card"><b>3–6</b><span>Players</span></article><article class="stat-card"><b>9</b><span>Factions</span></article><article class="stat-card"><b>∞</b><span>Lies Available</span></article><article class="stat-card"><b>1</b><span>Winning Allegiance</span></article></div></section>
    <section class="section"><div class="section-heading split-heading"><div><p class="eyebrow">CHOOSE YOUR ALLEGIANCE</p><h2>Nine factions.<br>Very few truths.</h2></div><a class="text-link" href="#/factions">Open faction archive →</a></div><div class="faction-grid">${data.factions.slice(0,8).map(factionCard).join("")}</div></section>
    <section class="section"><div class="section-heading split-heading"><div><p class="eyebrow">THE HOARD</p><h2>Every card leaves evidence.</h2></div><a class="text-link" href="#/cards">Enter Card Archive →</a></div><div class="card-grid">${data.cards.slice(0,6).map(gameCard).join("")}</div></section>
    <section class="section vault-tease"><div class="vault-door"><div class="vault-core"><span>K&amp;D ARCHIVE</span><strong>THE VAULT</strong><small>ACCESS VARIES</small></div></div><div class="vault-copy"><p class="eyebrow">FORBIDDEN KNOWLEDGE</p><h2>Some files should stay closed.</h2><p>Vault codes are now checked by the database instead of being exposed in site-data.json.</p><a class="btn primary" href="#/vault">Request Vault Access</a></div></section>
    <section class="section"><div class="section-heading"><p class="eyebrow">INTERCEPTED TRANSMISSIONS</p><h2>Whispers beyond the Veil.</h2></div><div class="timeline">${data.whispers.slice(0,3).map(whisper).join("")}</div></section>`;
  }

  function factionsPage(){
    return `<section class="page-hero"><p class="eyebrow">THE NINE</p><h1>FACTIONS</h1><p>Allegiances are chosen. Motives are hidden.</p></section><section class="section"><div class="faction-grid">${data.factions.map(factionCard).join("")}</div></section>`;
  }

  function factionPage(slug){
    const f=faction(slug); if(!f)return notFound("FACTION RECORD");
    const open=live(f),cards=data.cards.filter(c=>(c.faction_slug||c.faction)===slug);
    return `<section class="faction-hero" style="--accent:${esc(f.accent)}"><div class="faction-emblem">${esc(f.rune)}</div><div><p class="eyebrow">${open?"FACTION ARCHIVE":"CLEARANCE DENIED"}</p><h1>${esc(open?f.name:"CLASSIFIED")}</h1><p>${esc(f.tagline)}</p>${countdown(f)}</div></section>
    <section class="section faction-lore">${open?`<div class="lore-copy"><p class="eyebrow">ARCHIVE ENTRY</p><h2>The doctrine</h2><p>${esc(f.lore||"")}</p><blockquote>${esc(f.doctrine||"")}</blockquote></div><div class="dossier"><span>STATUS</span><strong>REVEALED</strong><span>RECORD</span><strong>${esc(f.slug.toUpperCase())}</strong></div>`:`<div class="classified-block"><h2>FILE SEALED</h2><p>The archive has detected this faction, but public clearance has not yet been granted.</p></div>`}</section>
    ${open&&cards.length?`<section class="section"><div class="section-heading"><p class="eyebrow">KNOWN ASSETS</p><h2>${esc(f.name)} cards.</h2></div><div class="card-grid">${cards.map(gameCard).join("")}</div></section>`:""}`;
  }

  function cardsPage(){
    return `<section class="page-hero"><p class="eyebrow">KLANDESTINE CARD ARCHIVE</p><h1>THE HOARD</h1><p>Cards are now driven by PostgreSQL. Owner changes appear without rebuilding the site.</p></section><section class="section"><form id="card-filters" class="archive-filters"><select id="filter-faction"><option value="">All factions</option>${data.factions.map(f=>`<option value="${esc(f.slug)}">${esc(f.name)}</option>`).join("")}</select><select id="filter-rarity"><option value="">All rarities</option>${[...new Set(data.cards.map(c=>c.rarity))].map(v=>`<option>${esc(v)}</option>`).join("")}</select><select id="filter-type"><option value="">All types</option>${[...new Set(data.cards.map(c=>c.card_type||c.type))].map(v=>`<option>${esc(v)}</option>`).join("")}</select><button class="btn ghost">Filter Archive</button><button type="button" id="reset-filters" class="btn ghost">Reset</button></form><div id="cards-result" class="card-grid archive-grid">${data.cards.map(gameCard).join("")}</div></section>`;
  }

  async function collectionQty(cardId){
    if(!session?.user || !cardId) return 0;
    const {data:r}=await sb.from("collections").select("quantity").eq("user_id",session.user.id).eq("card_id",cardId).maybeSingle();
    return r?.quantity||0;
  }

  async function cardPage(slug){
    const c=data.cards.find(x=>x.slug===slug); if(!c)return notFound("CARD DOSSIER");
    const open=live(c),f=faction(c.faction_slug||c.faction),qty=await collectionQty(c.id);
    return `<section class="card-dossier"><div><div class="game-card giant rarity-${esc((c.rarity||"Common").toLowerCase())} ${open?"":"classified-card"}"><div class="foil"></div><div class="card-top"><span>#${String(c.card_number??c.number??0).padStart(3,"0")}</span><span>${esc(c.rarity)}</span></div><div class="card-art"><img src="${esc(c.image_url||c.image||"assets/img/card-back.svg")}" alt=""></div><div class="card-copy"><span>${esc(c.faction_name||f?.name||"UNKNOWN")}</span><h2>${esc(open?c.name:"CLASSIFIED")}</h2><small>${esc(c.card_type||c.type)}</small></div></div></div><div class="card-record"><p class="eyebrow">CARD DOSSIER</p><h1>${esc(open?c.name:"██████████")}</h1>${open?`<div class="record-grid"><span>Faction</span><b>${esc(c.faction_name||f?.name||"Unknown")}</b><span>Rarity</span><b>${esc(c.rarity)}</b><span>Type</span><b>${esc(c.card_type||c.type)}</b></div><h3>ABILITY</h3><p>${esc(c.ability||"")}</p><h3>LORE</h3><p>${esc(c.lore||"")}</p>${session?.user&&c.id?`<form id="collection-form" data-card-id="${c.id}" class="collection-form"><label>Copies in My Archive <input id="collection-qty" type="number" min="0" max="99" value="${qty}"></label><button class="btn primary">Update Collection</button></form>`:`<a class="btn ghost" href="#/login">Sign in to track this card</a>`}`:countdown(c)}</div></section>`;
  }

  function vaultPage(){
    const files=data.vault.map(v=>{const open=v.unlocked||live(v);return `<article class="vault-file ${open?"":"locked"}"><div class="file-top"><span>${esc(v.code)}</span><b>${open?"ACCESS GRANTED":"🔒 CLASSIFIED"}</b></div><h2>${esc(open?v.title:"████████████")}</h2><p>${esc(v.teaser)}</p>${open?`<div class="file-body">${esc(v.body||"")}</div>`:`<div class="redactions"><i></i><i></i><i></i></div>${countdown(v)}`}</article>`}).join("");
    return `<section class="page-hero"><p class="eyebrow">AUTHORIZED EYES ONLY</p><h1>THE VAULT</h1><p>Codes are validated securely by Supabase and are no longer shipped in the public website source.</p></section><section class="section terminal-wrap"><div class="terminal"><div class="terminal-bar">K&amp;D ARCHIVE NETWORK // DATABASE NODE</div><pre>&gt; SIGNAL: ${backendOnline?"STABLE":"FALLBACK"}
&gt; IDENTITY: ${session?.user?esc(session.user.email):"ANONYMOUS"}
&gt; CODE INPUT: READY_</pre>${session?.user?`<form id="vault-code-form"><input id="vault-code" autocomplete="off" placeholder="ENTER VAULT CODE"><button class="btn primary">UNLOCK</button></form>`:`<a class="btn primary" href="#/login">Sign In to Enter Codes</a>`}<p id="vault-message"></p></div></section><section class="section"><div class="vault-grid">${files}</div></section>`;
  }

  function whispersPage(){
    return `<section class="page-hero"><p class="eyebrow">SIGNALS / RUMORS / FRAGMENTS</p><h1>WHISPERS</h1><p>The official record is incomplete.</p></section><section class="section narrow"><div class="timeline">${data.whispers.map(whisper).join("")}</div></section>`;
  }

  function learnPage(){
    return `<section class="page-hero"><p class="eyebrow">FIELD MANUAL 01</p><h1>LEARN KLANDESTINE</h1><p>Know the rules. Hide your allegiance. Never assume the table is telling you the truth.</p></section><section class="section"><div class="rule-steps"><article class="rule-card"><span>01</span><h2>DRAW</h2><p>Build options before the table understands what you are holding.</p></article><article class="rule-card"><span>02</span><h2>DECEIVE</h2><p>Use Kloaks and hidden information to make certainty impossible.</p></article><article class="rule-card"><span>03</span><h2>MANEUVER</h2><p>Attack, bargain, pressure, or let someone else do the damage.</p></article><article class="rule-card"><span>04</span><h2>FULFILL</h2><p>Every faction wants something. Win before the table learns exactly what.</p></article></div></section><section class="section manual-copy"><h2>Setup</h2><p>Klandestine begins with hidden allegiance. Prepare the deck, establish the players, distribute required faction information, and keep private information private.</p><h2>Kloaks</h2><p>Kloaks preserve uncertainty. Bluff, protect intent, create false narratives, and force opponents to decide without complete information.</p><h2>Victory</h2><p>Victory is faction-dependent. Everyone is trying to win. Nobody is required to tell you how.</p></section>`;
  }

  function forgePage(){
    return `<section class="page-hero"><p class="eyebrow">CUSTOM 3D PRINTING</p><h1>THE FORGE</h1><p>Forge requests are now real database records tied to player accounts.</p><div class="hero-actions"><a class="btn primary" href="#/forge-order">Start an Order</a><a class="btn ghost" href="#/reviews">Reviews</a></div></section><section class="section service-grid"><article class="service-card"><span>01</span><h2>Transmit</h2><p>Submit the build through your account.</p></article><article class="service-card"><span>02</span><h2>Forge</h2><p>Owner status updates are stored in PostgreSQL.</p></article><article class="service-card"><span>03</span><h2>Track</h2><p>See every order from My Archive.</p></article></section>`;
  }

  function forgeOrderPage(){
    if(!session?.user)return requireLogin("Sign in before transmitting a Forge order.");
    return `<section class="page-hero compact"><p class="eyebrow">FORGE REQUEST</p><h1>BUILD SOMETHING REAL.</h1><p>This request will be saved to your account.</p></section><section class="section form-section"><form id="forge-form" class="kd-form"><div class="form-grid"><label>Name<input id="fo-name" value="${esc(profile?.display_name||"")}" required></label><label>Email<input id="fo-email" type="email" value="${esc(session.user.email||"")}" required></label><label>Phone<input id="fo-phone"></label><label>Print Type<select id="fo-type"><option>FDM</option><option>Resin</option><option>Not sure</option></select></label><label>Quantity<input id="fo-qty" type="number" min="1" value="1"></label><label>Deadline<input id="fo-deadline" type="date"></label></div><label>Model / source link<input id="fo-link"></label><label>Colors<input id="fo-colors"></label><label>Build brief<textarea id="fo-notes" rows="7"></textarea></label><button class="btn primary">Submit Forge Order</button><p id="forge-message"></p></form></section>`;
  }

  async function accountPage(){
    if(!session?.user)return requireLogin("Sign in to access My Archive.");
    const [co,orders]=await Promise.all([
      sb.from("collections").select("card_id,quantity,updated_at").eq("user_id",session.user.id),
      sb.from("forge_orders").select("*").eq("user_id",session.user.id).order("created_at",{ascending:false})
    ]);
    const cmap=new Map(data.cards.map(c=>[c.id,c]));
    const collection=(co.data||[]).map(x=>({...x,card:cmap.get(x.card_id)})).filter(x=>x.card);
    return `<section class="page-hero compact"><p class="eyebrow">CLOUD PLAYER ARCHIVE</p><h1>MY ARCHIVE</h1><p>${esc(session.user.email)} · synchronized through Supabase</p><div class="hero-actions"><button id="logout-button" class="btn ghost">Sign Out</button>${isAdmin()?`<a class="btn primary" href="#/admin">Command Center</a>`:""}</div></section>
    <section class="section"><div class="section-heading"><p class="eyebrow">MY COLLECTION</p><h2>${collection.length} unique cards logged.</h2></div><div class="collection-grid">${collection.length?collection.map(x=>`<a class="collection-item" href="#/card/${encodeURIComponent(x.card.slug)}"><span>#${String(x.card.card_number).padStart(3,"0")}</span><h3>${esc(x.card.name)}</h3><p>${esc(x.card.rarity)}</p><b>×${x.quantity}</b></a>`).join(""):`<div class="empty-panel"><h2>Your archive is empty.</h2><a class="btn primary" href="#/cards">Enter The Hoard</a></div>`}</div></section>
    <section class="section"><div class="section-heading"><p class="eyebrow">THE FORGE</p><h2>My Orders</h2></div><div class="order-list">${(orders.data||[]).length?(orders.data||[]).map(o=>`<article class="admin-card"><span class="micro">${esc(o.order_code)}</span><h3>${esc(o.print_type||"Forge Order")}</h3><p><b>Status:</b> ${esc(o.status.replaceAll("_"," "))}</p><p>${esc(o.customer_update||"No owner update yet.")}</p><small>${fmtDate(o.created_at)}</small></article>`).join(""):`<div class="empty-panel">No Forge orders yet.</div>`}</div></section>`;
  }

  function loginPage(mode="login"){
    if(session?.user)return `<section class="page-hero"><h1>ALREADY CLEARED</h1><a class="btn primary" href="#/account">Open My Archive</a></section>`;
    const signup=mode==="signup";
    return `<section class="page-hero compact"><p class="eyebrow">ARCHIVE IDENTITY</p><h1>${signup?"CREATE IDENTITY":"SIGN IN"}</h1></section><section class="section form-section"><form id="auth-form" data-mode="${signup?"signup":"login"}" class="kd-form">${signup?`<label>Display Name<input id="auth-name" required></label>`:""}<label>Email<input id="auth-email" type="email" required></label><label>Passphrase<input id="auth-password" type="password" minlength="10" required></label><button class="btn primary">${signup?"Create Identity":"Request Clearance"}</button><p id="auth-message"></p><p>${signup?`Already registered? <a href="#/login">Sign in</a>`:`Need an identity? <a href="#/signup">Create one</a>`}</p></form></section>`;
  }

  function reviewsPage(){
    return `<section class="page-hero compact"><p class="eyebrow">FIELD REPORTS</p><h1>REVIEWS</h1></section><section class="section two-col"><div id="reviews-list"><div class="loading-panel">Loading approved reports…</div></div><form id="review-form" class="kd-form"><h2>Leave a field report</h2><label>Name<input id="rv-name" value="${esc(profile?.display_name||"")}" required></label><label>Rating<select id="rv-rating"><option value="5">★★★★★</option><option value="4">★★★★</option><option value="3">★★★</option><option value="2">★★</option><option value="1">★</option></select></label><label>Review<textarea id="rv-body" rows="7" required></textarea></label><button class="btn primary">Submit for Approval</button><p id="review-message"></p></form></section>`;
  }

  function contactPage(){
    return `<section class="page-hero compact"><p class="eyebrow">OPEN CHANNEL</p><h1>CONTACT</h1><p>Your transmission is stored securely for the K&D owner team.</p></section><section class="section form-section"><form id="contact-form" class="kd-form"><div class="form-grid"><label>Name<input id="ct-name" value="${esc(profile?.display_name||"")}" required></label><label>Email<input id="ct-email" type="email" value="${esc(session?.user?.email||"")}" required></label></div><label>Subject<input id="ct-subject" required></label><label>Message<textarea id="ct-message" rows="8" required></textarea></label><button class="btn primary">Transmit Message</button><p id="contact-message"></p></form></section>`;
  }

  async function adminPage(){
    if(!session?.user)return requireLogin("Owner clearance required.");
    if(!isAdmin())return `<section class="page-hero"><p class="eyebrow">CLEARANCE DENIED</p><h1>COMMAND CENTER</h1><p>This identity does not have owner/admin clearance.</p></section>`;
    const [orders,profiles,reviews,contacts,cards,factions]=await Promise.all([
      sb.from("forge_orders").select("*").order("created_at",{ascending:false}).limit(100),
      sb.from("profiles").select("*").order("created_at",{ascending:false}),
      sb.from("reviews").select("*").order("created_at",{ascending:false}).limit(100),
      sb.from("contacts").select("*").order("created_at",{ascending:false}).limit(100),
      sb.from("cards").select("*").order("sort_order"),
      sb.from("factions").select("*").order("sort_order")
    ]);
    return `<section class="page-hero compact"><p class="eyebrow">OWNER SYSTEM // SUPABASE LIVE</p><h1>COMMAND CENTER</h1><p>Database-backed control without moving the frontend off GitHub.</p><div class="hero-actions"><button id="logout-button" class="btn ghost">Sign Out</button><a class="btn ghost" href="#/">View Site</a></div></section>
    <section class="section admin-dashboard">
      <div class="admin-tabs"><button data-admin-tab="orders">Forge Orders (${orders.data?.length||0})</button><button data-admin-tab="cards">Cards (${cards.data?.length||0})</button><button data-admin-tab="factions">Factions (${factions.data?.length||0})</button><button data-admin-tab="reviews">Reviews</button><button data-admin-tab="contacts">Inbox</button><button data-admin-tab="users">Users</button></div>
      <div class="admin-pane" data-pane="orders">${(orders.data||[]).map(o=>`<form class="admin-card admin-order-form" data-id="${o.id}"><span class="micro">${esc(o.order_code)}</span><h3>${esc(o.customer_name)}</h3><p>${esc(o.email)} · ${esc(o.print_type||"")}</p><label>Status<select name="status">${["new","quoted","approved","printing","quality_check","ready","completed","cancelled"].map(s=>`<option value="${s}" ${o.status===s?"selected":""}>${s.replaceAll("_"," ")}</option>`).join("")}</select></label><label>Customer Update<input name="customer_update" value="${esc(o.customer_update||"")}"></label><button class="btn primary">Save Order</button></form>`).join("")||`<div class="empty-panel">No Forge orders.</div>`}</div>
      <div class="admin-pane" data-pane="cards" hidden>${(cards.data||[]).map(c=>`<form class="admin-card admin-card-form" data-id="${c.id}"><span class="micro">#${String(c.card_number).padStart(3,"0")} · ${esc(c.slug)}</span><label>Name<input name="name" value="${esc(c.name)}"></label><div class="form-grid"><label>Rarity<input name="rarity" value="${esc(c.rarity)}"></label><label>Type<input name="card_type" value="${esc(c.card_type)}"></label></div><label>Ability<textarea name="ability">${esc(c.ability||"")}</textarea></label><label>Lore<textarea name="lore">${esc(c.lore||"")}</textarea></label><label>Reveal At<input type="datetime-local" name="reveal_at" value="${c.reveal_at?esc(c.reveal_at.slice(0,16)):""}"></label><label class="check"><input type="checkbox" name="revealed" ${c.revealed?"checked":""}> Reveal immediately</label><button class="btn primary">Save Card</button></form>`).join("")}</div>
      <div class="admin-pane" data-pane="factions" hidden>${(factions.data||[]).map(f=>`<form class="admin-card admin-faction-form" data-id="${f.id}"><span class="micro">${esc(f.slug)}</span><label>Name<input name="name" value="${esc(f.name)}"></label><label>Tagline<input name="tagline" value="${esc(f.tagline||"")}"></label><label>Lore<textarea name="lore">${esc(f.lore||"")}</textarea></label><label>Doctrine<textarea name="doctrine">${esc(f.doctrine||"")}</textarea></label><label>Reveal At<input type="datetime-local" name="reveal_at" value="${f.reveal_at?esc(f.reveal_at.slice(0,16)):""}"></label><label class="check"><input type="checkbox" name="revealed" ${f.revealed?"checked":""}> Reveal immediately</label><button class="btn primary">Save Faction</button></form>`).join("")}</div>
      <div class="admin-pane" data-pane="reviews" hidden>${(reviews.data||[]).map(r=>`<article class="admin-card"><div class="stars">${"★".repeat(r.rating)}</div><h3>${esc(r.name)}</h3><p>${esc(r.body)}</p><p>${r.approved?"APPROVED":"WAITING"}</p>${!r.approved?`<button class="btn primary approve-review" data-id="${r.id}">Approve</button>`:""}</article>`).join("")}</div>
      <div class="admin-pane" data-pane="contacts" hidden>${(contacts.data||[]).map(c=>`<article class="admin-card"><span class="micro">${esc(c.status)} · ${fmtDate(c.created_at)}</span><h3>${esc(c.subject)}</h3><p><b>${esc(c.name)}</b> · ${esc(c.email)}</p><p>${esc(c.message)}</p>${c.status==="new"?`<button class="btn ghost mark-contact-read" data-id="${c.id}">Mark Read</button>`:""}</article>`).join("")}</div>
      <div class="admin-pane" data-pane="users" hidden>${(profiles.data||[]).map(u=>`<form class="admin-card admin-user-form" data-id="${u.id}"><h3>${esc(u.display_name||u.email||"User")}</h3><p>${esc(u.email||"")}</p><label>Role<select name="role">${["player","admin","owner"].map(r=>`<option ${u.role===r?"selected":""}>${r}</option>`).join("")}</select></label><label class="check"><input type="checkbox" name="active" ${u.active?"checked":""}> Active</label><button class="btn ghost">Save User</button></form>`).join("")}</div>
    </section>`;
  }

  function requireLogin(msg){
    return `<section class="page-hero"><p class="eyebrow">IDENTITY REQUIRED</p><h1>SIGN IN</h1><p>${esc(msg)}</p><div class="hero-actions"><a class="btn primary" href="#/login">Sign In</a><a class="btn ghost" href="#/signup">Create Identity</a></div></section>`;
  }

  function notFound(label="SIGNAL"){
    return `<section class="page-hero"><p class="eyebrow">404 / ${esc(label)} LOST</p><h1>BEHIND THE VEIL.</h1><a class="btn primary" href="#/">Return Home</a></section>`;
  }

  async function render(){
    await loadContent();
    const [p,arg]=route();
    if(!p) app.innerHTML=home();
    else if(p==="factions")app.innerHTML=factionsPage();
    else if(p==="faction")app.innerHTML=factionPage(arg);
    else if(p==="cards")app.innerHTML=cardsPage();
    else if(p==="card")app.innerHTML=await cardPage(arg);
    else if(p==="vault")app.innerHTML=vaultPage();
    else if(p==="whispers")app.innerHTML=whispersPage();
    else if(p==="learn")app.innerHTML=learnPage();
    else if(p==="forge")app.innerHTML=forgePage();
    else if(p==="forge-order")app.innerHTML=forgeOrderPage();
    else if(p==="account")app.innerHTML=await accountPage();
    else if(p==="login")app.innerHTML=loginPage("login");
    else if(p==="signup")app.innerHTML=loginPage("signup");
    else if(p==="reviews")app.innerHTML=reviewsPage();
    else if(p==="contact")app.innerHTML=contactPage();
    else if(p==="admin")app.innerHTML=await adminPage();
    else app.innerHTML=notFound();

    updateHeader();
    bind();
    enhance();
    if(p==="reviews")loadReviews();
    scrollTo({top:0,behavior:"instant"});
  }

  async function loadReviews(){
    const box=$("#reviews-list"); if(!box)return;
    const {data:r,error}=await sb.from("reviews").select("*").eq("approved",true).order("created_at",{ascending:false});
    box.innerHTML=error?`<div class="empty-panel">${esc(error.message)}</div>`:(r||[]).map(x=>`<article class="admin-card"><div class="stars">${"★".repeat(x.rating)}</div><p>“${esc(x.body)}”</p><strong>— ${esc(x.name)}</strong></article>`).join("")||`<div class="empty-panel">No approved reviews yet.</div>`;
  }

  function bind(){
    $("#intro")?.addEventListener("click",e=>{localStorage.setItem("kd-intro-v5","1");e.currentTarget.remove();document.body.classList.remove("intro-locked")});

    $("#auth-form")?.addEventListener("submit",async e=>{
      e.preventDefault(); const mode=e.currentTarget.dataset.mode,email=$("#auth-email").value.trim(),password=$("#auth-password").value,msg=$("#auth-message");
      msg.textContent="Working…";
      if(mode==="signup"){
        const display_name=$("#auth-name").value.trim();
        const {data:r,error}=await sb.auth.signUp({email,password,options:{data:{display_name},emailRedirectTo:KD_CONFIG.customDomain+"/#/account"}});
        if(error){msg.textContent=error.message;return}
        msg.textContent=r.session?"Identity created. Opening archive…":"Identity created. Check your email for confirmation.";
        if(r.session){session=r.session;await loadProfile();location.hash="#/account"}
      }else{
        const {data:r,error}=await sb.auth.signInWithPassword({email,password});
        if(error){msg.textContent=error.message;return}
        session=r.session;await loadProfile();location.hash=isAdmin()?"#/admin":"#/account";
      }
    });

    $("#logout-button")?.addEventListener("click",async()=>{await sb.auth.signOut();session=null;profile=null;location.hash="#/"});

    $("#collection-form")?.addEventListener("submit",async e=>{
      e.preventDefault(); const cardId=Number(e.currentTarget.dataset.cardId),q=Math.max(0,Math.min(99,parseInt($("#collection-qty").value)||0));
      if(q===0){
        const {error}=await sb.from("collections").delete().eq("user_id",session.user.id).eq("card_id",cardId);
        if(error)return alert(error.message);
      }else{
        const {error}=await sb.from("collections").upsert({user_id:session.user.id,card_id:cardId,quantity:q,updated_at:new Date().toISOString()});
        if(error)return alert(error.message);
      }
      alert("My Archive synchronized."); render();
    });

    $("#vault-code-form")?.addEventListener("submit",async e=>{
      e.preventDefault();const msg=$("#vault-message");msg.textContent="VERIFYING…";
      const {error}=await sb.rpc("unlock_vault_code",{input_code:$("#vault-code").value.trim()});
      if(error){msg.textContent=error.message;return}
      msg.textContent="ACCESS GRANTED";data=null;await loadContent(true);render();
    });

    $("#forge-form")?.addEventListener("submit",async e=>{
      e.preventDefault();const msg=$("#forge-message");msg.textContent="TRANSMITTING…";
      const d=new Date(),code=`KD-${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,"0")}-${Math.floor(1000+Math.random()*9000)}`;
      const payload={order_code:code,user_id:session.user.id,customer_name:$("#fo-name").value.trim(),email:$("#fo-email").value.trim(),phone:$("#fo-phone").value.trim(),print_type:$("#fo-type").value,quantity:Number($("#fo-qty").value)||1,deadline:$("#fo-deadline").value||null,source_link:$("#fo-link").value.trim(),colors:$("#fo-colors").value.trim(),notes:$("#fo-notes").value.trim()};
      const {data:r,error}=await sb.from("forge_orders").insert(payload).select().single();
      if(error){msg.textContent=error.message;return}
      msg.innerHTML=`ORDER RECEIVED: <strong>${esc(r.order_code)}</strong> · <a href="#/account">Track in My Archive</a>`;
      e.currentTarget.reset();
    });

    $("#review-form")?.addEventListener("submit",async e=>{
      e.preventDefault();const msg=$("#review-message");
      const payload={user_id:session?.user?.id||null,name:$("#rv-name").value.trim(),rating:Number($("#rv-rating").value),body:$("#rv-body").value.trim(),approved:false};
      const {error}=await sb.from("reviews").insert(payload);
      msg.textContent=error?error.message:"Review received and waiting for approval.";
      if(!error)e.currentTarget.reset();
    });

    $("#contact-form")?.addEventListener("submit",async e=>{
      e.preventDefault();const msg=$("#contact-message"),payload={user_id:session?.user?.id||null,name:$("#ct-name").value.trim(),email:$("#ct-email").value.trim(),subject:$("#ct-subject").value.trim(),message:$("#ct-message").value.trim()};
      const {error}=await sb.from("contacts").insert(payload);
      msg.textContent=error?error.message:"Transmission received.";
      if(!error)e.currentTarget.reset();
    });

    $("#card-filters")?.addEventListener("submit",e=>{
      e.preventDefault();const f=$("#filter-faction").value,r=$("#filter-rarity").value,t=$("#filter-type").value;
      const rows=data.cards.filter(c=>(!f||(c.faction_slug||c.faction)===f)&&(!r||c.rarity===r)&&(!t||(c.card_type||c.type)===t));
      $("#cards-result").innerHTML=rows.map(gameCard).join("");enhance();
    });
    $("#reset-filters")?.addEventListener("click",()=>{$("#filter-faction").value=$("#filter-rarity").value=$("#filter-type").value="";$("#cards-result").innerHTML=data.cards.map(gameCard).join("");enhance()});

    $("[data-admin-tab]")?.parentElement?.addEventListener("click",e=>{
      const b=e.target.closest("[data-admin-tab]");if(!b)return;
      $$(".admin-pane").forEach(p=>p.hidden=p.dataset.pane!==b.dataset.adminTab);
    });

    $$(".admin-order-form").forEach(f=>f.addEventListener("submit",async e=>{
      e.preventDefault();const fd=new FormData(f),payload={status:fd.get("status"),customer_update:fd.get("customer_update"),updated_at:new Date().toISOString()};
      const {error}=await sb.from("forge_orders").update(payload).eq("id",f.dataset.id);alert(error?error.message:"Order updated.");if(!error)render();
    }));

    $$(".admin-card-form").forEach(f=>f.addEventListener("submit",async e=>{
      e.preventDefault();const fd=new FormData(f),payload={name:fd.get("name"),rarity:fd.get("rarity"),card_type:fd.get("card_type"),ability:fd.get("ability"),lore:fd.get("lore"),revealed:fd.get("revealed")==="on",reveal_at:fd.get("reveal_at")?new Date(fd.get("reveal_at")).toISOString():null};
      const {error}=await sb.from("cards").update(payload).eq("id",f.dataset.id);alert(error?error.message:"Card updated.");if(!error){data=null;render()}
    }));

    $$(".admin-faction-form").forEach(f=>f.addEventListener("submit",async e=>{
      e.preventDefault();const fd=new FormData(f),payload={name:fd.get("name"),tagline:fd.get("tagline"),lore:fd.get("lore"),doctrine:fd.get("doctrine"),revealed:fd.get("revealed")==="on",reveal_at:fd.get("reveal_at")?new Date(fd.get("reveal_at")).toISOString():null};
      const {error}=await sb.from("factions").update(payload).eq("id",f.dataset.id);alert(error?error.message:"Faction updated.");if(!error){data=null;render()}
    }));

    $$(".approve-review").forEach(b=>b.addEventListener("click",async()=>{const {error}=await sb.from("reviews").update({approved:true}).eq("id",b.dataset.id);alert(error?error.message:"Review approved.");if(!error)render()}));
    $$(".mark-contact-read").forEach(b=>b.addEventListener("click",async()=>{const {error}=await sb.from("contacts").update({status:"read"}).eq("id",b.dataset.id);if(error)alert(error.message);else render()}));
    $$(".admin-user-form").forEach(f=>f.addEventListener("submit",async e=>{e.preventDefault();const fd=new FormData(f),{error}=await sb.rpc("admin_set_user_role",{target_user:f.dataset.id,new_role:fd.get("role"),new_active:fd.get("active")==="on"});alert(error?error.message:"User updated.");if(!error)render()}));
  }

  function enhance(){
    if("IntersectionObserver" in window&&!matchMedia("(prefers-reduced-motion: reduce)").matches){
      const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("visible");io.unobserve(e.target)}}),{threshold:.08});$$(".reveal").forEach(x=>io.observe(x));
    }else $$(".reveal").forEach(x=>x.classList.add("visible"));

    $$(".game-card,.faction-tile,.stat-card").forEach(card=>{
      card.addEventListener("pointermove",e=>{if(innerWidth<850)return;const r=card.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;card.style.setProperty("--rx",`${y*-7}deg`);card.style.setProperty("--ry",`${x*9}deg`);card.style.setProperty("--mx",`${(e.clientX-r.left)/r.width*100}%`);card.style.setProperty("--my",`${(e.clientY-r.top)/r.height*100}%`)});
      card.addEventListener("pointerleave",()=>{card.style.removeProperty("--rx");card.style.removeProperty("--ry")});
    });

    const cds=$$("[data-countdown]");
    if(cds.length){
      const tick=()=>cds.forEach(el=>{let d=new Date(el.dataset.countdown).getTime()-Date.now();if(d<=0){el.textContent="THE VEIL HAS LIFTED";return}const days=Math.floor(d/86400000);d%=86400000;const h=Math.floor(d/3600000);d%=3600000;const m=Math.floor(d/60000),s=Math.floor((d%60000)/1000);el.textContent=`${days}D ${String(h).padStart(2,"0")}H ${String(m).padStart(2,"0")}M ${String(s).padStart(2,"0")}S`});
      tick();setTimeout(tick,1000);
    }
  }

  document.querySelector("[data-year]").textContent=new Date().getFullYear();
  const header=$("#site-header");addEventListener("scroll",()=>header.classList.toggle("scrolled",scrollY>25),{passive:true});
  const toggle=$(".nav-toggle"),nav=$(".main-nav");
  toggle.addEventListener("click",()=>{const o=toggle.getAttribute("aria-expanded")==="true";toggle.setAttribute("aria-expanded",String(!o));nav.classList.toggle("open",!o)});
  $$("a",nav).forEach(a=>a.addEventListener("click",()=>nav.classList.remove("open")));
  addEventListener("pointermove",e=>{const g=$(".cursor-glow");g.style.left=e.clientX+"px";g.style.top=e.clientY+"px"},{passive:true});
  addEventListener("hashchange",render);

  if(sb){
    sb.auth.onAuthStateChange(async(_event,newSession)=>{
      session=newSession;
      await loadProfile();
      updateHeader();
    });
  }

  (async()=>{
    await loadAuth();
    await render();
  })().catch(e=>{console.error(e);app.innerHTML=`<div class="fatal">K&D initialization failed: ${esc(e.message)}</div>`});
})();
