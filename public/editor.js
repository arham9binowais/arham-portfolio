(function(){
'use strict';
const TOKEN = new URLSearchParams(location.search).get('token') || sessionStorage.getItem('token');
let DATA = null;
let currentSection = 'hero';
let autoSaveTimer = null;

// Online-session tracking: ping the server periodically so it knows this
// editor tab is still open (server-side, a session with no heartbeat for
// 15-30 min is treated as "browser closed" and reported). On tab close/
// navigate away, best-effort tell the server immediately via sendBeacon,
// which can't carry an Authorization header, so the token goes in the body.
if (TOKEN) {
  const HEARTBEAT_MS = 60000;
  const ping = () => fetch('/api/heartbeat', { method: 'POST', headers: { 'Authorization': 'Bearer ' + TOKEN } }).catch(() => {});
  ping();
  setInterval(ping, HEARTBEAT_MS);
  addEventListener('pagehide', () => {
    try { navigator.sendBeacon('/api/auth/logout', new Blob([JSON.stringify({ token: TOKEN })], { type: 'application/json' })); } catch(e) {}
  });
}

// =============================================
// DRAG & DROP SYSTEM
// =============================================
function initSidebarDrag() {
  const list = document.getElementById('sidebar-sections-list');
  if (!list) return;
  list.addEventListener('dragstart', function(e) {
    const btn = e.target.closest('.sidebar-btn-draggable');
    if (!btn) { e.preventDefault(); return; }
    btn.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', btn.getAttribute('data-sid'));
  });
  list.addEventListener('dragend', function(e) {
    const btn = e.target.closest('.sidebar-btn-draggable');
    if (btn) btn.classList.remove('dragging', 'drag-ghost');
    clearDropIndicators(list);
  });
  list.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const btn = e.target.closest('.sidebar-btn-draggable');
    if (!btn || btn.classList.contains('dragging')) return;
    clearDropIndicators(list);
    const rect = btn.getBoundingClientRect();
    btn.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
  });
  list.addEventListener('dragleave', function(e) {
    if (!list.contains(e.relatedTarget)) clearDropIndicators(list);
  });
  list.addEventListener('drop', function(e) {
    e.preventDefault(); clearDropIndicators(list);
    const targetBtn = e.target.closest('.sidebar-btn-draggable');
    if (!targetBtn) return;
    const draggedId = e.dataTransfer.getData('text/plain');
    const targetId = targetBtn.getAttribute('data-sid');
    if (draggedId === targetId) return;
    if (!DATA.sectionOrder) DATA.sectionOrder = getDefaultSectionOrder();
    const order = DATA.sectionOrder;
    let di = order.indexOf(draggedId), ti = order.indexOf(targetId);
    if (di < 0 || ti < 0) return;
    const rect = targetBtn.getBoundingClientRect();
    if (e.clientY > rect.top + rect.height / 2) ti++;
    order.splice(di, 1);
    if (ti > di) ti--;
    order.splice(ti, 0, draggedId);
    scheduleSave(); renderSidebar(); initSidebarDrag(); switchSection(currentSection);
  });
}

function clearDropIndicators(root) {
  if (!root) return;
  root.querySelectorAll('.drop-above,.drop-below').forEach(el => { el.classList.remove('drop-above','drop-below'); });
}

// =============================================
// ITEM / ELEMENT CARD DRAG (handle-gated)
// =============================================
function initItemCardDrag(mainEl) {
  if (!mainEl) return;
  let dragItem = null, dragIdx = -1, dragZone = null, dragCards = [];

  function getDirectCards(zone) {
    return [...zone.children].filter(c => c.matches('.item-card,.element-card,.element-card-nested,.section-btn-card'));
  }

  function findZone(el) {
    return el.closest('[data-dnd-type]');
  }

  mainEl.addEventListener('mousedown', function(e) {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const card = handle.closest('.item-card,.element-card,.element-card-nested,.section-btn-card');
    if (card) card.setAttribute('draggable','true');
  });
  mainEl.addEventListener('mouseup', function(e) {
    const card = e.target.closest('.item-card,.element-card,.element-card-nested,.section-btn-card');
    if (card) card.setAttribute('draggable','false');
  });

  mainEl.addEventListener('dragstart', function(e) {
    const card = e.target.closest('.item-card,.element-card,.element-card-nested,.section-btn-card');
    if (!card || card.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
    dragZone = findZone(card);
    if (!dragZone) { e.preventDefault(); return; }
    dragCards = getDirectCards(dragZone);
    dragItem = card;
    dragIdx = dragCards.indexOf(card);
    if (dragIdx < 0) { e.preventDefault(); return; }
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragIdx));
  });

  mainEl.addEventListener('dragend', function(e) {
    const card = e.target.closest('.item-card,.element-card,.element-card-nested,.section-btn-card');
    if (card) { card.classList.remove('dragging'); card.setAttribute('draggable','false'); }
    clearDropIndicators(mainEl);
    dragItem = null; dragIdx = -1; dragZone = null; dragCards = [];
  });

  mainEl.addEventListener('dragover', function(e) {
    e.preventDefault();
    if (!dragItem || !dragZone) return;
    const card = e.target.closest('.item-card,.element-card,.element-card-nested,.section-btn-card');
    if (!card || card === dragItem) return;
    const targetZone = findZone(card);
    if (targetZone !== dragZone) { e.dataTransfer.dropEffect = 'none'; return; }
    e.dataTransfer.dropEffect = 'move';
    clearDropIndicators(mainEl);
    const rect = card.getBoundingClientRect();
    card.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
  });

  mainEl.addEventListener('dragleave', function(e) {
    if (!mainEl.contains(e.relatedTarget)) clearDropIndicators(mainEl);
  });

  mainEl.addEventListener('drop', function(e) {
    e.preventDefault();
    if (!dragItem || !dragZone) return;
    clearDropIndicators(mainEl);
    const card = e.target.closest('.item-card,.element-card,.element-card-nested,.section-btn-card');
    if (!card || card === dragItem) return;
    const targetZone = findZone(card);
    if (targetZone !== dragZone) return;
    let toIdx = dragCards.indexOf(card);
    if (dragIdx < 0 || toIdx < 0) return;
    const rect = card.getBoundingClientRect();
    if (e.clientY > rect.top + rect.height / 2) toIdx++;
    const sectionKey = dragZone.getAttribute('data-dnd-section');
    const dndType = dragZone.getAttribute('data-dnd-type');
    const parentIdx = dragZone.hasAttribute('data-dnd-parent') ? parseInt(dragZone.getAttribute('data-dnd-parent')) : -1;
    doReorder(sectionKey, dndType, parentIdx, dragIdx, toIdx, dragItem.getAttribute('data-box-token'), card.getAttribute('data-box-token'));
  });
}

function doReorder(sectionKey, dndType, parentIdx, fromIdx, toIdx, fromKey, toKey) {
  let arr;
  if (dndType === 'custom-elements') {
    const ci = parseInt(sectionKey.replace('custom-',''));
    arr = DATA.customSections[ci] && DATA.customSections[ci].elements;
  } else if (dndType === 'box-children') {
    const ci = parseInt(sectionKey.replace('custom-',''));
    const box = DATA.customSections[ci] && DATA.customSections[ci].elements[parentIdx];
    if (!box) return;
    const order = getBoxOrder(box);
    if (!fromKey || !toKey) return;
    const fromOrderIdx = order.indexOf(fromKey), toOrderIdx = order.indexOf(toKey);
    if (fromOrderIdx < 0 || toOrderIdx < 0) return;
    order.splice(fromOrderIdx, 1);
    order.splice(toOrderIdx > fromOrderIdx ? toOrderIdx - 1 : toOrderIdx, 0, fromKey);
    box.boxOrder = order;
    scheduleSave(); renderSection(currentSection);
    return;
  } else if (dndType === 'section-buttons') {
    if (sectionKey.startsWith('custom-')) {
      const ci = parseInt(sectionKey.replace('custom-',''));
      arr = DATA.customSections[ci] && DATA.customSections[ci].sectionButtons;
    } else {
      arr = DATA[sectionKey] && DATA[sectionKey].sectionButtons;
    }
  } else if (sectionKey === 'nav') {
    arr = DATA.navigation;
  } else if (DATA[sectionKey]) {
    const map = { stats:'stats', skills:'categories', education:'entries', certs:'items', projects:'items' };
    if (map[dndType]) arr = DATA[sectionKey][map[dndType]];
  }
  if (!arr || !Array.isArray(arr)) return;
  if (fromIdx === toIdx || fromIdx === toIdx - 1) return;
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);
  scheduleSave(); renderSection(currentSection);
}

// =============================================
// DEFAULTS
// =============================================
function getDefaultSectionOrder() {
  const o = ['hero','about','skills','education','certifications','projects','contact'];
  (DATA.customSections||[]).forEach(cs => { if(cs.id) o.push(cs.id); });
  return o;
}

// =============================================
// INIT
// =============================================
async function init() {
  if (!TOKEN) { location.href='/'; return; }
  try { const r = await fetch('/api/auth/validate',{headers:{'Authorization':'Bearer '+TOKEN}}); if(!r.ok){location.href='/';return;} }
  catch(e){location.href='/';return;}
  await loadAndRender();
}

async function loadAndRender() {
  try {
    const r = await fetch('/api/portfolio'); DATA = await r.json();
    if(!DATA.customSections) DATA.customSections=[];
    if(!DATA.sectionOrder) DATA.sectionOrder=getDefaultSectionOrder();
    ['hero','about','skills','education','certifications','projects','footer'].forEach(s=>{
      if(DATA[s]&&!DATA[s].sectionButtons) DATA[s].sectionButtons=[];
    });
    renderSidebar(); initSidebarDrag(); switchSection('hero');
  } catch(e){alert('Failed to load data');}
}

// =============================================
// SIDEBAR
// =============================================
function renderSidebar() {
  const list = document.getElementById('sidebar-sections-list');
  if(!list) return;
  const order = getOrderedSections();
  const meta = {hero:{icon:'fa-home',label:'Hero'},about:{icon:'fa-user',label:'About'},skills:{icon:'fa-cogs',label:'Skills'},education:{icon:'fa-graduation-cap',label:'Education'},certifications:{icon:'fa-certificate',label:'Certifications'},projects:{icon:'fa-folder-open',label:'Projects'},contact:{icon:'fa-envelope',label:'Contact'}};
  let h='';
  order.forEach(sid=>{
    const isCustom = sid.startsWith('cs-');
    let secKey,icon,label,isActive,del='';
    if(isCustom){
      const idx=DATA.customSections.findIndex(cs=>cs.id===sid); if(idx<0)return;
      secKey='custom-'+idx; icon='fa-puzzle-piece'; label=DATA.customSections[idx].title||'Section '+(idx+1);
      isActive=currentSection===secKey;
      del=`<button class="sidebar-del" onclick="event.stopPropagation();deleteCustomSection(${idx})" title="Delete"><i class="fas fa-trash"></i></button>`;
    } else {
      secKey=sid; const m=meta[sid]; if(!m)return; icon=m.icon; label=m.label; isActive=currentSection===secKey;
    }
    h+=`<button class="sidebar-btn sidebar-btn-draggable ${isActive?'active':''} ${isCustom?'sidebar-btn-custom':''}" data-section="${secKey}" data-sid="${sid}" draggable="true"><span class="drag-handle sidebar-grip" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span><i class="fas ${icon}"></i> <span>${esc(label)}</span>${del}</button>`;
  });
  list.innerHTML=h;
  list.querySelectorAll('.sidebar-btn-draggable').forEach(btn=>{
    btn.addEventListener('click',function(e){
      if(e.target.closest('.sidebar-del')||e.target.closest('.drag-handle'))return;
      switchSection(this.getAttribute('data-section'));
    });
  });
  document.querySelectorAll('.sidebar-bottom-sections .sidebar-btn-draggable').forEach(btn=>{
    btn.addEventListener('click',function(e){
      if(e.target.closest('.drag-handle'))return;
      switchSection(this.getAttribute('data-section'));
    });
  });
}

function getOrderedSections(){if(!DATA.sectionOrder)DATA.sectionOrder=getDefaultSectionOrder();return DATA.sectionOrder;}

window.switchSection=function(sec){
  currentSection=sec;
  document.querySelectorAll('.sidebar-btn').forEach(b=>b.classList.remove('active'));
  const sid=getSidFromKey(sec);
  const btn=document.querySelector(`[data-sid="${sid}"]`);
  if(btn)btn.classList.add('active');
  renderSection(sec);
};

function getSidFromKey(k){if(k.startsWith('custom-')){const i=parseInt(k.replace('custom-',''));return DATA.customSections[i]?DATA.customSections[i].id:k;}return k;}

// =============================================
// SECTION ROUTER
// =============================================
function renderSection(sec){
  const m=document.getElementById('editor-main');
  const r={hero:rHero,about:rAbout,skills:rSkills,education:rEducation,certifications:rCerts,projects:rProjects,contact:rContact,nav:rNav,footer:rFooter};
  if(r[sec]){r[sec](m);initItemCardDrag(m);return;}
  if(sec.startsWith('custom-')){rCustomSection(m,parseInt(sec.replace('custom-','')));initItemCardDrag(m);return;}
  m.innerHTML='<p>Unknown section</p>';
}

// =============================================
// HELPERS
// =============================================
function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function uid(){return'id-'+Date.now()+'-'+Math.random().toString(36).substr(2,5);}
function fld(l,v,k,s){return`<div class="form-group"><label class="form-label">${l}</label><input class="form-input" data-section="${s}" data-key="${k}" value="${esc(v||'')}"></div>`;}
function fldA(l,v,k,s){return`<div class="form-group"><label class="form-label">${l}</label><textarea class="form-textarea" data-section="${s}" data-key="${k}">${esc(v||'')}</textarea></div>`;}
function row(...c){return`<div class="form-row">${c.join('')}</div>`;}
function hdr(i,t){return`<div class="section-header"><h2><i class="fas ${i}"></i> ${t}</h2></div>`;}
function grip(){return`<span class="drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>`;}

// Section download buttons
function rSecBtns(sk){
  const btns=(DATA[sk]&&DATA[sk].sectionButtons)||[];
  let h=`<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border)" data-dnd-section="${sk}" data-dnd-type="section-buttons"><div class="section-header" style="margin-bottom:1rem"><h2 style="font-size:1rem"><i class="fas fa-download"></i> Section Buttons & Downloads</h2></div>`;
  btns.forEach((b,i)=>{
    h+=`<div class="section-btn-card" draggable="false"><div class="item-drag-header">${grip()}<span class="item-card-title">Button ${i+1}</span><button class="item-card-del" onclick="removeSectionBtn('${sk}',${i})" title="Remove"><i class="fas fa-trash"></i></button></div><div style="flex:1"><div class="form-label">Button Text</div><input class="form-input" data-section="${sk}" data-sb-index="${i}" data-sb-key="text" value="${esc(b.text)}" style="margin-bottom:.4rem"><div class="form-label">Link (URL / file link)</div><input class="form-input" data-section="${sk}" data-sb-index="${i}" data-sb-key="link" value="${esc(b.link)}"></div></div>`;
  });
  h+=`<button class="add-item-btn" onclick="addSectionBtn('${sk}')"><i class="fas fa-plus"></i> Add Button / Download Link</button></div>`;
  return h;
}
window.addSectionBtn=function(s){if(!DATA[s])DATA[s]={};if(!DATA[s].sectionButtons)DATA[s].sectionButtons=[];DATA[s].sectionButtons.push({text:'Download',link:'https://',id:uid()});scheduleSave();renderSection(currentSection);};
window.removeSectionBtn=function(s,i){DATA[s].sectionButtons.splice(i,1);scheduleSave();renderSection(currentSection);};

// =============================================
// BUILT-IN SECTION RENDERERS
// =============================================
function rHero(m){const d=DATA.hero;let h=hdr('fa-home','Hero Section');h+=fld('Greeting',d.greeting,'greeting','hero');h+=fld('Name',d.name,'name','hero');h+=fld('Subtitle',d.subtitle,'subtitle','hero');h+=fld('CTA Text',d.ctaText,'ctaText','hero');h+=fld('CTA Link',d.ctaLink,'ctaLink','hero');h+=fld('Resume Text',d.resumeText,'resumeText','hero');h+=fld('Resume Link',d.resumeLink,'resumeLink','hero');h+='<div class="form-group"><label class="form-label">Titles (one per line)</label><textarea class="form-textarea" data-section="hero" data-key="titles" data-json-array="true">'+(d.titles||[]).join('\n')+'</textarea></div>';h+=rSecBtns('hero');m.innerHTML=h;}

function rAbout(m){const d=DATA.about;let h=hdr('fa-user','About Section');h+=fld('Heading',d.heading,'heading','about');h+=fldA('Description',d.description,'description','about');h+=fldA('Description 2',d.description2,'description2','about');h+='<div class="form-group"><label class="form-label">Stats</label><div data-dnd-section="about" data-dnd-type="stats">';(d.stats||[]).forEach((s,i)=>{h+=`<div class="item-card" draggable="false"><div class="item-drag-header">${grip()}<span class="item-card-title">Stat ${i+1}</span><button class="item-card-del" onclick="removeStat(${i})"><i class="fas fa-trash"></i></button></div>${row(fld('Value',s.value,'stats.'+i+'.value','about'),fld('Label',s.label,'stats.'+i+'.label','about'))}</div>`;});h+='</div><button class="add-item-btn" onclick="addStat()"><i class="fas fa-plus"></i> Add Stat</button></div>';h+=rSecBtns('about');m.innerHTML=h;}
window.addStat=function(){DATA.about.stats.push({value:'0',label:'New'});scheduleSave();renderSection(currentSection);};
window.removeStat=function(i){DATA.about.stats.splice(i,1);scheduleSave();renderSection(currentSection);};

function rSkills(m){const d=DATA.skills;let h=hdr('fa-cogs','Skills Section');h+=fld('Heading',d.heading,'heading','skills');h+='<div data-dnd-section="skills" data-dnd-type="skills">';(d.categories||[]).forEach((c,i)=>{h+=`<div class="item-card" draggable="false"><div class="item-drag-header">${grip()}<span class="item-card-title">${esc(c.name)}</span><button class="item-card-del" onclick="removeSkillCat(${i})"><i class="fas fa-trash"></i></button></div>${row(fld('Category Name',c.name,'categories.'+i+'.name','skills'),fld('Icon (fa-*)',c.icon,'categories.'+i+'.icon','skills'))}<div class="form-group"><label class="form-label">Skills (comma separated)</label><input class="form-input" data-section="skills" data-key="categories.${i}.items" data-comma-list="true" value="${(c.items||[]).join(', ')}"></div></div>`;});h+='</div><button class="add-item-btn" onclick="addSkillCat()"><i class="fas fa-plus"></i> Add Skill Category</button>';h+=rSecBtns('skills');m.innerHTML=h;}
window.addSkillCat=function(){DATA.skills.categories.push({name:'New Category',icon:'fa-star',items:[]});scheduleSave();renderSection(currentSection);};
window.removeSkillCat=function(i){DATA.skills.categories.splice(i,1);scheduleSave();renderSection(currentSection);};

function rEducation(m){const d=DATA.education;let h=hdr('fa-graduation-cap','Education Section');h+=fld('Heading',d.heading,'heading','education');h+='<div data-dnd-section="education" data-dnd-type="education">';(d.entries||[]).forEach((e,i)=>{h+=`<div class="item-card" draggable="false"><div class="item-drag-header">${grip()}<span class="item-card-title">${esc(e.degree||'Entry '+(i+1))}</span><button class="item-card-del" onclick="removeEdu(${i})"><i class="fas fa-trash"></i></button></div>${fld('Degree',e.degree,'entries.'+i+'.degree','education')}${fld('Institution',e.institution,'entries.'+i+'.institution','education')}${fld('Year',e.year,'entries.'+i+'.year','education')}${fldA('Description',e.description,'entries.'+i+'.description','education')}</div>`;});h+='</div><button class="add-item-btn" onclick="addEdu()"><i class="fas fa-plus"></i> Add Education</button>';h+=rSecBtns('education');m.innerHTML=h;}
window.addEdu=function(){DATA.education.entries.push({degree:'',institution:'',year:'',description:'',id:uid()});scheduleSave();renderSection(currentSection);};
window.removeEdu=function(i){DATA.education.entries.splice(i,1);scheduleSave();renderSection(currentSection);};

function rCerts(m){const d=DATA.certifications;let h=hdr('fa-certificate','Certifications Section');h+=fld('Heading',d.heading,'heading','certifications');h+='<div data-dnd-section="certifications" data-dnd-type="certs">';(d.items||[]).forEach((c,i)=>{h+=`<div class="item-card" draggable="false"><div class="item-drag-header">${grip()}<span class="item-card-title">${esc(c.name||'Cert '+(i+1))}</span><button class="item-card-del" onclick="removeCert(${i})"><i class="fas fa-trash"></i></button></div>${fld('Name',c.name,'items.'+i+'.name','certifications')}${fld('Issuer',c.issuer,'items.'+i+'.issuer','certifications')}${fld('Date',c.date,'items.'+i+'.date','certifications')}</div>`;});h+='</div><button class="add-item-btn" onclick="addCert()"><i class="fas fa-plus"></i> Add Certification</button>';h+=rSecBtns('certifications');m.innerHTML=h;}
window.addCert=function(){DATA.certifications.items.push({name:'',issuer:'',date:'',id:uid()});scheduleSave();renderSection(currentSection);};
window.removeCert=function(i){DATA.certifications.items.splice(i,1);scheduleSave();renderSection(currentSection);};

function rProjects(m){const d=DATA.projects;let h=hdr('fa-folder-open','Projects Section');h+=fld('Heading',d.heading,'heading','projects');h+='<div data-dnd-section="projects" data-dnd-type="projects">';(d.items||[]).forEach((p,i)=>{h+=`<div class="item-card" draggable="false"><div class="item-drag-header">${grip()}<span class="item-card-title">${esc(p.title||'Project '+(i+1))}</span><button class="item-card-del" onclick="removeProj(${i})"><i class="fas fa-trash"></i></button></div>${fld('Title',p.title,'items.'+i+'.title','projects')}${fldA('Description',p.description,'items.'+i+'.description','projects')}${fld('Highlight',p.highlight,'items.'+i+'.highlight','projects')}${fld('Link',p.link,'items.'+i+'.link','projects')}<div class="form-group"><label class="form-label">Tags (comma separated)</label><input class="form-input" data-section="projects" data-key="items.${i}.tags" data-comma-list="true" value="${(p.tags||[]).join(', ')}"></div></div>`;});h+='</div><button class="add-item-btn" onclick="addProj()"><i class="fas fa-plus"></i> Add Project</button>';h+=rSecBtns('projects');m.innerHTML=h;}
window.addProj=function(){DATA.projects.items.push({title:'',description:'',tags:[],link:'#',id:uid(),highlight:''});scheduleSave();renderSection(currentSection);};
window.removeProj=function(i){DATA.projects.items.splice(i,1);scheduleSave();renderSection(currentSection);};

function rContact(m){const d=DATA.contact;let h=hdr('fa-envelope','Contact Section');h+=fld('Heading',d.heading,'heading','contact');h+=fldA('Description',d.description,'description','contact');h+=row(fld('Email',d.email,'email','contact'),fld('Phone',d.phone,'phone','contact'));h+=fld('GitHub URL',d.github,'github','contact');h+=fld('GitHub Display Text',d.githubDisplay,'githubDisplay','contact');h+='<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)"><div class="section-header" style="margin-bottom:1rem"><h2 style="font-size:1rem"><i class="fas fa-address-card"></i> Contact Info Buttons</h2></div>';(d.buttons||[]).forEach((b,i)=>{h+=`<div class="item-card"><div class="item-card-header"><span class="item-card-title">${esc(b.type||'button')}</span></div>${fld('Display Text',b.text,'buttons.'+i+'.text','contact')}${fld('Link (mailto:/tel:/https:)',b.link,'buttons.'+i+'.link','contact')}<div class="form-group"><label class="form-label">Type</label><select class="form-select" data-section="contact" data-key="buttons.${i}.type"><option value="email" ${b.type==='email'?'selected':''}>Email</option><option value="phone" ${b.type==='phone'?'selected':''}>Phone</option><option value="github" ${b.type==='github'?'selected':''}>GitHub</option></select></div></div>`;});h+='</div>';m.innerHTML=h;}

function rNav(m){let h=hdr('fa-bars','Navigation');h+='<div data-dnd-section="nav" data-dnd-type="nav">';(DATA.navigation||[]).forEach((n,i)=>{h+=`<div class="item-card" draggable="false"><div class="item-drag-header">${grip()}<span class="item-card-title">Link ${i+1}</span><button class="item-card-del" onclick="removeNav(${i})"><i class="fas fa-trash"></i></button></div>${row(fld('Text',n.text,'navigation.'+i+'.text','nav'),fld('Link (#section)',n.link,'navigation.'+i+'.link','nav'))}</div>`;});h+='</div><button class="add-item-btn" onclick="addNav()"><i class="fas fa-plus"></i> Add Nav Link</button>';m.innerHTML=h;}
window.addNav=function(){DATA.navigation.push({text:'New',link:'#'});scheduleSave();renderSection(currentSection);};
window.removeNav=function(i){DATA.navigation.splice(i,1);scheduleSave();renderSection(currentSection);};

function rFooter(m){let h=hdr('fa-paragraph','Footer');h+=fld('Footer Text',DATA.footer.text,'text','footer');h+=rSecBtns('footer');m.innerHTML=h;}

// =============================================
// CUSTOM SECTIONS with NESTABLE BOX ELEMENTS
// =============================================
function rCustomSection(m,idx){
  const sec=DATA.customSections[idx];
  if(!sec){m.innerHTML='<p>Section not found</p>';return;}
  let h=hdr('fa-puzzle-piece','Custom Section: '+(sec.title||'Untitled'));
  h+=fld('Section Title',sec.title,'customTitle','custom-'+idx);
  h+=rSecBtns('custom-'+idx);
  h+='<div style="margin-top:1.5rem"><div class="section-header" style="margin-bottom:.8rem"><h2 style="font-size:1rem"><i class="fas fa-shapes"></i> Elements</h2></div>';
  h+='<div class="add-element-toolbar">';
 const tb=[['text','fa-align-left','Text'],['heading','fa-heading','Heading'],['box','fa-square','Box'],['button','fa-arrow-right','Button'],['download','fa-download','Download'],['input','fa-keyboard','Input'],['link','fa-link','Link'],['list','fa-list','List'],['image','fa-image','Image'],['divider','fa-minus','Divider'],['spacer','fa-arrows-alt-v','Spacer']];
  tb.forEach(([t,ic,l])=>{h+=`<button class="ae-btn" onclick="addEl(${idx},'${t}')"><i class="fas ${ic}"></i> ${l}</button>`;});
  h+='</div>';
  // Elements list
  h+=`<div data-dnd-section="custom-${idx}" data-dnd-type="custom-elements">`;
  (sec.elements||[]).forEach((el,ei)=>{h+=renderElCard(el,idx,ei,-1);});
  h+='</div></div>';
  m.innerHTML=h;
}

// Render a single element card (section-level or nested in box)
function renderElCard(el,secIdx,elIdx,parentElIdx){
  const isNested=parentElIdx>=0;
  const cardClass=isNested?'element-card-nested':'element-card';
  const boxToken=isNested?` data-box-token="child:${el.id||''}"`:'';
  let h=`<div class="${cardClass}" draggable="false"${boxToken}>`;
  h+=`<div class="element-header">${grip()}<div class="element-type-badge">${el.type}</div><div class="element-actions">`;
  if(!isNested){
    h+=`<button onclick="moveEl(${secIdx},${elIdx},-1)" title="Move Up"><i class="fas fa-arrow-up"></i></button>`;
    h+=`<button onclick="moveEl(${secIdx},${elIdx},1)" title="Move Down"><i class="fas fa-arrow-down"></i></button>`;
  }
  h+=`<button class="el-del" onclick="removeEl(${secIdx},${elIdx},${parentElIdx},'${esc(el.id||'')}')" title="Delete"><i class="fas fa-trash"></i></button></div></div>`;
  h+=renderElFields(el,secIdx,elIdx,parentElIdx);
  // If box, render children zone
  if(el.type==='box'){
    const pIdx=parentElIdx>=0?parentElIdx:elIdx;
    h+=`<div class="box-children-zone" data-dnd-section="custom-${secIdx}" data-dnd-type="box-children" data-dnd-parent="${pIdx}">`;
    h+=`<div class="box-children-label"><i class="fas fa-layer-group"></i> Box Contents (drag to reorder)</div>`;
    getBoxOrder(el).forEach(token=>{
      if(token==='title') h+=renderBoxPart(el,secIdx,pIdx,'title','Box Title',fld('Title',el.title,'elements.'+pIdx+'.title','custom-'+secIdx));
      else if(token==='content') h+=renderBoxPart(el,secIdx,pIdx,'content','Box Content',fldA('Content',el.content,'elements.'+pIdx+'.content','custom-'+secIdx));
      else {
        const child=(el.children||[]).find((item,ci)=>'child:'+(item.id||ci)===token);
        if(child) h+=renderElCard(child,secIdx,(el.children||[]).indexOf(child),pIdx);
      }
    });
    h+='<div class="add-element-toolbar add-element-toolbar-nested">';
    [['text','fa-align-left','Text'],['heading','fa-heading','Heading'],['button','fa-arrow-right','Button'],['download','fa-download','Download'],['input','fa-keyboard','Input'],['link','fa-link','Link'],['image','fa-image','Image'],['spacer','fa-arrows-alt-v','Spacer']].forEach(([t,ic,l])=>{
      h+=`<button class="ae-btn" onclick="addBoxChild(${secIdx},${pIdx},'${t}')"><i class="fas ${ic}"></i> ${l}</button>`;
    });
    h+='</div></div>';
  }
  h+='</div>';
  return h;
}

function getBoxOrder(box){
  if(!box.boxOrder) box.boxOrder=['title','content'];
  (box.children||[]).forEach((child,i)=>{
    if(!child.id) child.id=uid();
    const token='child:'+child.id;
    if(!box.boxOrder.includes(token)) box.boxOrder.push(token);
  });
  box.boxOrder=box.boxOrder.filter(token=>token==='title'||token==='content'||(box.children||[]).some((child,i)=>token==='child:'+(child.id||i)));
  return box.boxOrder;
}

function renderBoxPart(box,secIdx,parentIdx,token,label,fields){
  return `<div class="element-card-nested box-part-card" draggable="false" data-box-token="${token}"><div class="element-header">${grip()}<div class="element-type-badge">${label}</div></div>${fields}</div>`;
}

// Render element editor fields
function renderElFields(el,secIdx,elIdx,parentElIdx){
  const s='custom-'+secIdx;
  let prefix;
  if(parentElIdx>=0){
    prefix='elements.'+parentElIdx+'.children.'+elIdx;
  } else {
    prefix='elements.'+elIdx;
  }
  switch(el.type){
    case 'text': case 'heading':
      return fldA(el.type==='heading'?'Heading Text':'Text Content',el.content,prefix+'.content',s);
    case 'box':
      return '';
    case 'button':
      return row(fld('Button Text',el.text,prefix+'.text',s),fld('Link',el.link,prefix+'.link',s))+`<div class="form-group"><label class="form-label">Style</label><select class="form-select" data-section="${s}" data-key="${prefix}.style"><option value="outline" ${el.style!=='primary'?'selected':''}>Outline</option><option value="primary" ${el.style==='primary'?'selected':''}>Primary (Gradient)</option></select></div>`;
    case 'download':
      return row(fld('Button Text',el.text,prefix+'.text',s),fld('File URL',el.link,prefix+'.link',s));
    case 'input':
      return fld('Label',el.label,prefix+'.label',s)+`<div class="form-row">${fld('Placeholder',el.placeholder,prefix+'.placeholder',s)}<div class="form-group"><label class="form-label">Type</label><select class="form-select" data-section="${s}" data-key="${prefix}.inputType"><option value="text" ${el.inputType==='text'?'selected':''}>Text</option><option value="email" ${el.inputType==='email'?'selected':''}>Email</option><option value="number" ${el.inputType==='number'?'selected':''}>Number</option><option value="url" ${el.inputType==='url'?'selected':''}>URL</option></select></div></div>`;
    case 'link':
      return row(fld('Link Text',el.text,prefix+'.text',s),fld('URL',el.link,prefix+'.link',s));
    case 'list':
      return `<div class="form-group"><label class="form-label">List Items (one per line)</label><textarea class="form-textarea" data-section="${s}" data-key="${prefix}.items" data-json-array="true">${(el.items||[]).join('\n')}</textarea></div>`;
    case 'image':
      return fld('Image URL',el.link,prefix+'.link',s)+fld('Alt Text',el.alt,prefix+'.alt',s);
    case 'spacer':
      return fld('Height (px)',el.height||'40',prefix+'.height',s);
    case 'divider':
      return '<p style="color:var(--text2);font-size:.85rem">Horizontal divider line</p>';
    default:
      return fldA('Content',el.content,prefix+'.content',s);
  }
}

// Element templates
const elTemplates={text:{type:'text',content:'Enter your text here...'},heading:{type:'heading',content:'Section Heading'},box:{type:'box',title:'Info Box',content:'Box content goes here.',children:[]},button:{type:'button',text:'Click Me',link:'https://',style:'outline'},download:{type:'download',text:'Download File',link:'https://'},input:{type:'input',label:'Your Name',placeholder:'Enter value...',inputType:'text'},link:{type:'link',text:'Visit Link',link:'https://'},list:{type:'list',items:['Item 1','Item 2','Item 3']},image:{type:'image',link:'',alt:''},divider:{type:'divider'},spacer:{type:'spacer',height:'40'}};

window.addEl=function(si,type){
  if(!DATA.customSections[si].elements)DATA.customSections[si].elements=[];
  DATA.customSections[si].elements.push({...elTemplates[type],id:uid()});
  scheduleSave();renderSection('custom-'+si);
};

window.addBoxChild=function(si,parentIdx,type){
  const box=DATA.customSections[si].elements[parentIdx];
  if(!box.children)box.children=[];
  const child={...elTemplates[type],id:uid()};
  box.children.push(child);
  getBoxOrder(box).push('child:'+child.id);
  scheduleSave();renderSection('custom-'+si);
};

window.removeEl=function(si,elIdx,parentIdx,childId){
  if(parentIdx>=0){
    const box=DATA.customSections[si].elements[parentIdx];
    if(!box||!Array.isArray(box.children))return;
    const childIndex=childId?box.children.findIndex(child=>child.id===childId):elIdx;
    if(childIndex<0)return;
    const [removed]=box.children.splice(childIndex,1);
    if(Array.isArray(box.boxOrder))box.boxOrder=box.boxOrder.filter(token=>token!=='child:'+removed.id);
  } else {
    DATA.customSections[si].elements.splice(elIdx,1);
  }
  scheduleSave();renderSection('custom-'+si);
};

window.moveEl=function(si,ei,dir){
  const els=DATA.customSections[si].elements;const ni=ei+dir;
  if(ni<0||ni>=els.length)return;
  [els[ei],els[ni]]=[els[ni],els[ei]];
  scheduleSave();renderSection('custom-'+si);
};

window.addNewCustomSection=function(){
  const ns={id:'cs-'+uid(),title:'New Section',elements:[],sectionButtons:[]};
  DATA.customSections.push(ns);
  if(!DATA.sectionOrder)DATA.sectionOrder=getDefaultSectionOrder();
  DATA.sectionOrder.push(ns.id);
  DATA.navigation.push({text:ns.title,link:'#'+ns.id});
  scheduleSave();renderSidebar();initSidebarDrag();switchSection('custom-'+(DATA.customSections.length-1));
};

window.deleteCustomSection=function(idx){
  const sid=DATA.customSections[idx].id;
  DATA.customSections.splice(idx,1);
  if(DATA.sectionOrder)DATA.sectionOrder=DATA.sectionOrder.filter(s=>s!==sid);
  DATA.navigation=DATA.navigation.filter(n=>n.link!=='#'+sid);
  scheduleSave();renderSidebar();initSidebarDrag();switchSection('hero');
};

// =============================================
// DATA COLLECTION & SAVE
// =============================================
function collectAll(){
  if(!DATA)return;
  document.querySelectorAll('[data-section][data-key]').forEach(input=>{
    const section=input.getAttribute('data-section');
    const key=input.getAttribute('data-key');
    const val=input.value;
    if(input.hasAttribute('data-comma-list')){setNested(DATA,section,key,val.split(',').map(s=>s.trim()).filter(Boolean));return;}
    if(input.hasAttribute('data-json-array')){setNested(DATA,section,key,val.split('\n').filter(Boolean));return;}
    setNested(DATA,section,key,val);
  });
  // Section buttons
  document.querySelectorAll('[data-sb-index][data-sb-key]').forEach(input=>{
    const s=input.getAttribute('data-section'),i=parseInt(input.getAttribute('data-sb-index')),k=input.getAttribute('data-sb-key');
    if(DATA[s]&&DATA[s].sectionButtons&&DATA[s].sectionButtons[i])DATA[s].sectionButtons[i][k]=input.value;
  });
  // Selects
  document.querySelectorAll('[data-section][data-key]').forEach(el=>{
    if(el.tagName==='SELECT')setNested(DATA,el.getAttribute('data-section'),el.getAttribute('data-key'),el.value);
  });
}

function setNested(obj,section,key,value){
  if(key==='customTitle'){
    const i=parseInt(section.replace('custom-',''));
    if(DATA.customSections[i]){
      DATA.customSections[i].title=value;
      const sid=DATA.customSections[i].id;
      const nav=DATA.navigation.find(n=>n.link==='#'+sid);
      if(nav)nav.text=value;
    }
    return;
  }
  const parts=key.split('.');
  let target;
  if(section==='nav')target=DATA.navigation;
  else if(section.startsWith('custom-')){
    const i=parseInt(section.replace('custom-',''));
    target=DATA.customSections[i];
    if(!target)return;
    if(parts[0]==='elements'){
      parts.shift();
      let el=target.elements;
      for(let j=0;j<parts.length-1;j++){const k=isNaN(parts[j])?parts[j]:parseInt(parts[j]);if(el[k]===undefined)el[k]={};el=el[k];}
      el[parts[parts.length-1]]=value;
      return;
    }
  } else {
    target=DATA[section];
    if(!target)return;
  }
  for(let i=0;i<parts.length-1;i++){const k=isNaN(parts[i])?parts[i]:parseInt(parts[i]);if(target[k]===undefined)target[k]={};target=target[k];}
  target[parts[parts.length-1]]=value;
}

async function saveData(){
  clearTimeout(autoSaveTimer);
  collectAll();
  if(!DATA.customSections)DATA.customSections=[];
  if(!DATA.sectionOrder)DATA.sectionOrder=getDefaultSectionOrder();
  try{const r=await fetch('/api/portfolio',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},body:JSON.stringify(DATA)});if(r.ok)showSaveStatus('saved');else showSaveStatus('error');}
  catch(e){showSaveStatus('error');}
}

function showSaveStatus(s){const el=document.getElementById('save-status');if(s==='saved')el.innerHTML='<i class="fas fa-circle" style="color:#00ff88;font-size:8px"></i> All changes saved';else if(s==='saving')el.innerHTML='<i class="fas fa-spinner fa-spin" style="color:#00d4ff;font-size:10px"></i> Saving...';else el.innerHTML='<i class="fas fa-circle" style="color:#f87171;font-size:8px"></i> Save failed';}
function scheduleSave(){showSaveStatus('saving');clearTimeout(autoSaveTimer);autoSaveTimer=setTimeout(saveData,2000);}

document.getElementById('editor-main').addEventListener('input',scheduleSave);
document.getElementById('editor-main').addEventListener('change',scheduleSave);
addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveData();}});

// JSON Editor
window.openJsonEditor=function(){collectAll();document.getElementById('json-textarea').value=JSON.stringify(DATA,null,2);document.getElementById('json-modal').style.display='flex';};
window.closeJsonEditor=function(){document.getElementById('json-modal').style.display='none';};
window.saveJsonEditor=function(){try{DATA=JSON.parse(document.getElementById('json-textarea').value);saveData();closeJsonEditor();renderSidebar();initSidebarDrag();renderSection(currentSection);}catch(e){alert('Invalid JSON: '+e.message);}};

// Logout
window.doLogout=async function(){await fetch('/api/auth/logout',{method:'POST',headers:{'Authorization':'Bearer '+TOKEN}});sessionStorage.clear();location.href='/';};

init();
})();
