 (function() {
  'use strict';
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token') || sessionStorage.getItem('token');
  const visitorName = urlParams.get('name') || sessionStorage.getItem('visitorName');
  if (visitorName) { document.getElementById('visitor-banner').style.display = 'flex'; document.getElementById('visitor-name-display').textContent = visitorName; }
  let portfolioData = null;

  // Online-session tracking: ping the server periodically so it knows this
  // tab is still open (server-side, a session with no heartbeat for 15-30
  // min is treated as "browser closed" and reported). On tab close/navigate
  // away, best-effort tell the server immediately via sendBeacon, which
  // can't carry an Authorization header, so the token goes in the body.
  if (token) {
    const HEARTBEAT_MS = 60000;
    const ping = () => fetch('/api/heartbeat', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {});
    ping();
    setInterval(ping, HEARTBEAT_MS);
    addEventListener('pagehide', () => {
      try { navigator.sendBeacon('/api/auth/logout', new Blob([JSON.stringify({ token })], { type: 'application/json' })); } catch(e) {}
    });
  }

  async function loadPortfolio() {
    try {
      const res = await fetch('/api/portfolio');
      if (!res.ok) throw new Error('Failed');
      portfolioData = await res.json();
      renderAll(portfolioData);
    } catch(e) {
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#8892b0;font-size:1.2rem;text-align:center;padding:2rem;"><div><h2>Could not connect to server</h2><p style="margin-top:1rem;">Make sure the server is running: <code style="color:#00d4ff;">node server.js</code></p></div></div>';
    }
  }

  function renderAll(data) {
    renderNav(data.navigation);
    // Render all built-in sections into their containers first
    renderHero(data.hero);
    renderAbout(data.about);
    renderSkills(data.skills);
    renderEducation(data.education);
    renderCertifications(data.certifications);
    renderProjects(data.projects);
    renderContact(data.contact);
    renderFooter(data.footer);
    // Render custom sections as standalone <section> elements
    const customSections = data.customSections || [];
    customSections.forEach(sec => {
      const sectionEl = document.createElement('section');
      sectionEl.id = sec.id;
      sectionEl.className = 'section custom-section';
      let html = '<div class="reveal"><div class="section-line"></div><h2 class="section-heading">' + esc(sec.title) + '</h2></div><div class="custom-elements reveal">';
      if (sec.elements) sec.elements.forEach(el => { html += renderCustomElement(el); });
      if (sec.sectionButtons && sec.sectionButtons.length) {
        html += '<div class="section-buttons">';
        sec.sectionButtons.forEach(b => { html += '<a href="' + esc(b.link) + '" target="_blank" rel="noopener" class="btn btn-outline">' + esc(b.text) + '</a>'; });
        html += '</div>';
      }
      html += '</div>';
      sectionEl.innerHTML = html;
      document.getElementById('sections-wrapper').appendChild(sectionEl);
    });
    // Reorder sections based on sectionOrder
    reorderSections(data.sectionOrder);
    initScrollReveal();
    initCounters();
    initTiltEffect();
    initSectionProgress();
  }

  function reorderSections(sectionOrder) {
    if (!sectionOrder || !Array.isArray(sectionOrder)) return;
    const wrapper = document.getElementById('sections-wrapper');
    if (!wrapper) return;
    // Reorder DOM elements to match sectionOrder
    sectionOrder.forEach(sid => {
      const el = document.getElementById(sid);
      if (el && el.parentNode === wrapper) {
        wrapper.appendChild(el);
      }
    });
  }

  const SECTION_ICONS = {
    hero: 'fa-house', about: 'fa-user', skills: 'fa-cogs', education: 'fa-graduation-cap',
    certifications: 'fa-certificate', projects: 'fa-folder-open', contact: 'fa-envelope'
  };
  function iconForLink(link) {
    const id = (link || '').replace('#', '');
    if (SECTION_ICONS[id]) return SECTION_ICONS[id];
    return id ? 'fa-puzzle-piece' : 'fa-link';
  }

  function renderFloatingNav(navItems) {
    const el = document.getElementById('floating-nav');
    if (!el) return;
    el.innerHTML = navItems.map(item =>
      `<a href="${esc(item.link)}" class="floating-nav-item"><i class="fas ${iconForLink(item.link)}"></i><span class="floating-nav-label">${esc(item.text)}</span></a>`
    ).join('');
  }

  function renderNav(navItems) {
    const nav = document.getElementById('nav-links');
    nav.innerHTML = navItems.map(item => `<li><a href="${item.link}">${item.text}</a></li>`).join('');
    renderFloatingNav(navItems);
    initHamburger();
  }

  function renderHero(hero) {
    document.getElementById('hero-greeting').textContent = hero.greeting;
    document.getElementById('hero-name').textContent = hero.name;
    document.getElementById('hero-subtitle').textContent = hero.subtitle;
    const btns = document.getElementById('hero-buttons');
    let btnHTML = `<a href="${hero.ctaLink}" class="btn btn-primary">${hero.ctaText} \u2192</a>`;
    if (hero.resumeLink && hero.resumeLink !== '#') btnHTML += `<a href="${hero.resumeLink}" class="btn btn-outline" target="_blank" rel="noopener">${hero.resumeText}</a>`;
    if (hero.sectionButtons) hero.sectionButtons.forEach(b => { btnHTML += `<a href="${b.link}" target="_blank" rel="noopener" class="btn btn-outline">${b.text}</a>`; });
    btns.innerHTML = btnHTML;
    if (hero.titles && hero.titles.length) startTyping(hero.titles);
  }

  function startTyping(titles) {
    const el = document.getElementById('typing-text');
    let ti = 0, ci = 0, deleting = false;
    function type() {
      const cur = titles[ti];
      if (deleting) { el.textContent = cur.substring(0, ci - 1); ci--; }
      else { el.textContent = cur.substring(0, ci + 1); ci++; }
      let delay = deleting ? 35 : 75;
      if (!deleting && ci === cur.length) { delay = 2000; deleting = true; }
      else if (deleting && ci === 0) { deleting = false; ti = (ti + 1) % titles.length; delay = 400; }
      setTimeout(type, delay);
    }
    type();
  }

  function renderCustomElement(el) {
    switch(el.type) {
      case 'text': return `<div class="custom-text">${el.content || ''}</div>`;
      case 'heading': return `<h3 class="custom-heading">${el.content || ''}</h3>`;
      case 'box': {
        let bh = '<div class="custom-box">';
        const order = Array.isArray(el.boxOrder) ? el.boxOrder : ['title', 'content', ...(el.children || []).map((c, i) => 'child:' + (c.id || i))];
        order.forEach(token => {
          if (token === 'title' && el.title) bh += '<div class="custom-box-title">' + esc(el.title) + '</div>';
          else if (token === 'content') bh += '<div class="custom-box-content">' + (el.content || '') + '</div>';
          else if (token.indexOf('child:') === 0) {
            const child = (el.children || []).find((c, i) => 'child:' + (c.id || i) === token);
            if (child) bh += renderCustomElement(child);
          }
        });
        bh += '</div>';
        return bh;
      }
      case 'button': return el.link ? `<a href="${esc(el.link)}" target="_blank" rel="noopener" class="btn ${el.style === 'primary' ? 'btn-primary' : 'btn-outline'}">${esc(el.text || 'Button')}</a>` : `<button class="btn ${el.style === 'primary' ? 'btn-primary' : 'btn-outline'}">${esc(el.text || 'Button')}</button>`;
      case 'download': return `<a href="${esc(el.link)}" download class="btn btn-download"><i class="fas fa-download"></i> ${esc(el.text || 'Download')}</a>`;
      case 'input': return `<div class="custom-input-wrapper"><label class="custom-input-label">${esc(el.label || 'Input')}</label><input type="${el.inputType || 'text'}" placeholder="${esc(el.placeholder || '')}" class="custom-input" ${el.readOnly ? 'readonly' : ''}></div>`;
      case 'divider': return '<hr class="custom-divider">';
      case 'spacer': return `<div style="height:${el.height || '40px'}"></div>`;
      case 'image': return el.link ? `<img src="${esc(el.link)}" alt="${esc(el.alt || '')}" class="custom-image">` : '';
      case 'list': return `<ul class="custom-list">${(el.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
      case 'link': return `<a href="${esc(el.link)}" target="_blank" rel="noopener" class="custom-link">${esc(el.text || 'Link')} <i class="fas fa-external-link-alt" style="font-size:0.75rem"></i></a>`;
      default: return `<div class="custom-text">${el.content || ''}</div>`;
    }
  }

  function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function renderAbout(about) {
    document.getElementById('about-heading').textContent = about.heading;
    const textEl = document.getElementById('about-text');
    let html = `<p>${about.description}</p>`;
    if (about.description2) html += `<p>${about.description2}</p>`;
    textEl.innerHTML = html;
    const statsGrid = document.getElementById('stats-grid');
    statsGrid.innerHTML = about.stats.map(s => `<div class="stat-card reveal-child"><div class="stat-value" data-count="${s.value}">${s.value}</div><div class="stat-label">${s.label}</div></div>`).join('');
  }

  function renderSkills(skills) {
    document.getElementById('skills-heading').textContent = skills.heading;
    document.getElementById('skills-grid').innerHTML = skills.categories.map(cat => `<div class="skill-category reveal-child" data-tilt><div class="skill-category-header"><div class="skill-icon"><i class="fas ${cat.icon}"></i></div><div class="skill-category-name">${cat.name}</div></div><div class="skill-tags">${cat.items.map(item => `<span class="skill-tag">${item}</span>`).join('')}</div></div>`).join('');
  }

  function renderEducation(education) {
    document.getElementById('education-heading').textContent = education.heading;
    document.getElementById('timeline').innerHTML = education.entries.map((e, i) => `<div class="timeline-item reveal-child reveal-${i%2===0?'left':'right'}"><div class="timeline-year">${e.year}</div><div class="timeline-degree">${e.degree}</div><div class="timeline-institution">${e.institution}</div><div class="timeline-desc">${e.description}</div></div>`).join('');
  }

  function renderCertifications(certs) {
    document.getElementById('certs-heading').textContent = certs.heading;
    document.getElementById('certs-grid').innerHTML = certs.items.map((c, i) => `<div class="cert-card reveal-child reveal-scale" style="transition-delay:${i*0.1}s"><span class="cert-icon">\u{1F3C5}</span><div class="cert-name">${c.name}</div><div class="cert-issuer">${c.issuer}</div><div class="cert-date">${c.date}</div></div>`).join('');
  }

  function renderProjects(projects) {
    document.getElementById('projects-heading').textContent = projects.heading;
    document.getElementById('projects-grid').innerHTML = projects.items.map((p, i) => {
      let hl = p.highlight ? `<div class="project-highlight">\u2B50 ${p.highlight}</div>` : '';
      return `<div class="project-card reveal-child reveal-scale" data-tilt style="transition-delay:${i*0.15}s"><div class="project-title">${p.title}</div><div class="project-desc">${p.description}</div>${hl}<div class="project-tags">${p.tags.map(t => `<span class="project-tag">${t}</span>`).join('')}</div>${p.link && p.link !== '#' ? `<a href="${p.link}" target="_blank" rel="noopener" class="project-link">View Project \u2192</a>` : ''}</div>`;
    }).join('');
  }

  function renderContact(contact) {
    document.getElementById('contact-heading').textContent = contact.heading;
    document.getElementById('contact-desc').textContent = contact.description;
    const btns = document.getElementById('contact-buttons');
    let html = '';
    (contact.buttons || []).forEach(btn => {
      const link = btn.link || '#';
      const type = btn.type || 'link';
      let icon = '\u{1F517}', label = 'Link', target = '', rel = '';
      if (type === 'email') { icon = '\u2709\uFE0F'; label = 'Email'; }
      else if (type === 'phone') { icon = '\u260E\uFE0F'; label = 'Phone'; }
      else if (type === 'github') { icon = '</>'; label = 'GitHub'; target = ' target="_blank"'; rel = ' rel="noopener noreferrer"'; }
      html += `<a href="${link}" class="contact-btn reveal-child"${target}${rel}><div class="contact-btn-icon">${icon}</div><div class="contact-btn-text"><div class="contact-btn-label">${label}</div><div class="contact-btn-value">${btn.text}</div></div></a>`;
    });
    btns.innerHTML = html;
  }

  function renderFooter(footer) {
    const el = document.getElementById('footer');
    let html = footer.text || '';
    if (footer.sectionButtons) footer.sectionButtons.forEach(b => { html += ` <a href="${esc(b.link)}" target="_blank" rel="noopener" class="btn btn-outline" style="margin-left:1rem;font-size:0.8rem;padding:0.4rem 1rem;">${esc(b.text)}</a>`; });
    el.innerHTML = html;
  }

  function initHamburger() {
    const h = document.getElementById('hamburger'), n = document.getElementById('nav-links');
    h.addEventListener('click', () => { h.classList.toggle('active'); n.classList.toggle('open'); });
    n.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { h.classList.remove('active'); n.classList.remove('open'); }));
  }

  function initScrollReveal() {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          e.target.querySelectorAll('.reveal-child').forEach((c, i) => {
            setTimeout(() => c.classList.add('visible'), parseInt(c.style.transitionDelay) || (i * 120));
          });
        }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });
    document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
  }

  function initCounters() {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { animateCounter(e.target); obs.unobserve(e.target); } });
    }, { threshold: 0.5 });
    document.querySelectorAll('.stat-value').forEach(el => obs.observe(el));
  }
  function animateCounter(el) {
    const ft = el.getAttribute('data-count') || el.textContent, m = ft.match(/(\d+)/);
    if (!m) return; const tn = parseInt(m[1]), pre = ft.substring(0, ft.indexOf(m[1])), suf = ft.substring(ft.indexOf(m[1]) + m[1].length), st = performance.now();
    function step(now) { const p = Math.min((now - st) / 1500, 1), c = Math.floor(tn * (1 - Math.pow(1 - p, 3))); el.textContent = pre + c + suf; if (p < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }

  function initTiltEffect() {
    document.querySelectorAll('[data-tilt]').forEach(card => {
      card.addEventListener('mousemove', e => {
        const r = card.getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
        card.style.transform = `perspective(800px) rotateX(${((e.clientY - r.top - cy) / cy) * -4}deg) rotateY(${((e.clientX - r.left - cx) / cx) * 4}deg) translateY(-6px)`;
      });
      card.addEventListener('mouseleave', () => { card.style.transform = 'perspective(800px) rotateX(0) rotateY(0) translateY(0)'; });
    });
  }

  function initSectionProgress() {
    const bar = document.createElement('div'); bar.id = 'scroll-progress';
    bar.style.cssText = 'position:fixed;top:0;left:0;height:3px;background:linear-gradient(90deg,#00d4ff,#7b2ff7,#00ff88);z-index:1001;transition:width 0.1s linear;width:0%;pointer-events:none;';
    document.body.appendChild(bar);
    addEventListener('scroll', () => { const s = scrollY, h = document.documentElement.scrollHeight - innerHeight; bar.style.width = (h > 0 ? (s / h) * 100 : 0) + '%'; });
  }

  function initStickyNav() {
    const nb = document.getElementById('navbar');
    addEventListener('scroll', () => {
      nb.classList.toggle('navbar-scrolled', scrollY > 50);
      const sections = document.querySelectorAll('section[id]'), links = document.querySelectorAll('.nav-links a');
      let cur = '';
      sections.forEach(s => { if (scrollY >= s.offsetTop - 120) cur = s.id; });
      links.forEach(l => { l.classList.toggle('active', l.getAttribute('href') === '#' + cur); });
    });
  }

  // Floating bottom-left quick-nav: appears once the top navbar hides on
  // scroll-down, so navigation is always within reach without scrolling back up.
  function initFloatingNav() {
    const navbar = document.getElementById('navbar');
    const floatingNav = document.getElementById('floating-nav');
    if (!navbar || !floatingNav) return;
    let lastY = scrollY;
    addEventListener('scroll', () => {
      const y = scrollY;
      const goingDown = y > lastY;
      if (y < 80) {
        navbar.classList.remove('navbar-hidden');
        floatingNav.classList.remove('visible');
      } else if (goingDown) {
        navbar.classList.add('navbar-hidden');
        floatingNav.classList.add('visible');
      } else {
        navbar.classList.remove('navbar-hidden');
        floatingNav.classList.remove('visible');
      }
      lastY = y;
    }, { passive: true });
  }

  // Particles
  function initParticles() {
    const cv = document.getElementById('particle-canvas'), cx = cv.getContext('2d');
    let ps = [], shapes = [], stars = [], ripples = [], mouse = {x:null,y:null}, hb = 220;
    function rz() { cv.width = innerWidth; cv.height = innerHeight; } rz(); addEventListener('resize', rz);
    addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
    addEventListener('mouseleave', () => { mouse.x = null; mouse.y = null; });
    addEventListener('click', e => { for(let i=0;i<3;i++) ripples.push({x:e.clientX,y:e.clientY,r:0,mr:80+i*40,a:0.4,s:2+i*.5}); });
    class P { constructor(){this.reset(true)} reset(i){this.x=i?Math.random()*cv.width:(Math.random()<.5?-10:cv.width+10);this.y=Math.random()*cv.height;this.sz=Math.random()*2.5+.5;this.sx=(Math.random()-.5)*.8;this.sy=(Math.random()-.5)*.8;this.h=hb+Math.random()*60;this.a=Math.random()*.5+.15;this.p=Math.random()*6.28;this.trail=[];} update(){if(mouse.x!==null){const dx=mouse.x-this.x,dy=mouse.y-this.y,d=Math.sqrt(dx*dx+dy*dy);if(d<180){const f=(180-d)/180;this.sx+=dx*f*.003;this.sy+=dy*f*.003;}}this.trail.push({x:this.x,y:this.y});if(this.trail.length>5)this.trail.shift();this.x+=this.sx;this.y+=this.sy;this.sx*=.992;this.sy*=.992;this.p+=.03;this.h=(hb+Math.sin(this.p)*30)%360;if(this.x<-20||this.x>cv.width+20||this.y<-20||this.y>cv.height+20)this.reset(false);} draw(){const s=this.sz*(1+Math.sin(this.p)*.3);for(let i=0;i<this.trail.length;i++){const t=this.trail[i];cx.beginPath();cx.arc(t.x,t.y,s*.5,0,6.28);cx.fillStyle=`hsla(${this.h},80%,60%,${(i/this.trail.length)*this.a*.3})`;cx.fill();}cx.beginPath();cx.arc(this.x,this.y,s*3.5,0,6.28);cx.fillStyle=`hsla(${this.h},80%,60%,${this.a*.08})`;cx.fill();cx.beginPath();cx.arc(this.x,this.y,s,0,6.28);cx.fillStyle=`hsla(${this.h},85%,65%,${this.a})`;cx.fill();}}
    class S{constructor(){this.reset()} reset(){this.x=Math.random()*cv.width;this.y=Math.random()*cv.height;this.sz=Math.random()*25+10;this.rot=Math.random()*6.28;this.rs=(Math.random()-.5)*.008;this.sx=(Math.random()-.5)*.25;this.sy=(Math.random()-.5)*.25;this.a=Math.random()*.05+.01;this.t=Math.floor(Math.random()*4);this.h=hb+Math.random()*80;} update(){this.x+=this.sx;this.y+=this.sy;this.rot+=this.rs;if(mouse.x!==null){const dx=this.x-mouse.x,dy=this.y-mouse.y,d=Math.sqrt(dx*dx+dy*dy);if(d<150){this.x+=dx*.005;this.y+=dy*.005;}}if(this.x<-60||this.x>cv.width+60)this.sx*=-1;if(this.y<-60||this.y>cv.height+60)this.sy*=-1;} draw(){cx.save();cx.translate(this.x,this.y);cx.rotate(this.rot);cx.strokeStyle=`hsla(${this.h},70%,50%,${this.a})`;cx.lineWidth=1;if(this.t===0){cx.beginPath();cx.arc(0,0,this.sz,0,6.28);cx.stroke();}else if(this.t===1){cx.strokeRect(-this.sz/2,-this.sz/2,this.sz,this.sz);}else if(this.t===2){cx.beginPath();cx.moveTo(0,-this.sz);cx.lineTo(this.sz*.866,this.sz*.5);cx.lineTo(-this.sz*.866,this.sz*.5);cx.closePath();cx.stroke();}else{cx.beginPath();cx.moveTo(0,-this.sz);cx.lineTo(this.sz*.6,0);cx.lineTo(0,this.sz);cx.lineTo(-this.sz*.6,0);cx.closePath();cx.stroke();}cx.restore();}}
    for(let i=0;i<140;i++)ps.push(new P());
    for(let i=0;i<12;i++)shapes.push(new S());
    for(let i=0;i<60;i++)stars.push({x:Math.random()*cv.width,y:Math.random()*cv.height,sz:Math.random()*1.2+.3,tw:Math.random()*6.28,sp:Math.random()*.03+.01});
    let shooters = [];
    setInterval(()=>{if(shooters.length<3)shooters.push({x:Math.random()*cv.width,y:Math.random()*cv.height*.5,len:Math.random()*80+40,sp:Math.random()*8+6,ang:Math.PI/4+(Math.random()-.5)*.3,a:1,dec:Math.random()*.015+.008,h:hb+Math.random()*40,active:true});},2500);
    function animate(t){cx.fillStyle='rgba(10,14,23,0.18)';cx.fillRect(0,0,cv.width,cv.height);
    [{x:cv.width*.2+Math.sin(t*.0003)*120,y:cv.height*.3+Math.cos(t*.0004)*90,r:280,c:'0,212,255'},{x:cv.width*.8+Math.cos(t*.0005)*140,y:cv.height*.7+Math.sin(t*.0003)*110,r:300,c:'123,47,247'},{x:cv.width*.5+Math.sin(t*.0004)*100,y:cv.height*.5+Math.cos(t*.0006)*70,r:220,c:'0,255,136'},{x:cv.width*.15+Math.cos(t*.0006)*80,y:cv.height*.8+Math.sin(t*.0005)*60,r:180,c:'255,100,50'}].forEach(o=>{const g=cx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r);g.addColorStop(0,`rgba(${o.c},0.035)`);g.addColorStop(1,`rgba(${o.c},0)`);cx.fillStyle=g;cx.fillRect(o.x-o.r,o.y-o.r,o.r*2,o.r*2);});
    stars.forEach(s=>{s.tw+=s.sp;const a=0.2+Math.sin(s.tw)*.2;cx.beginPath();cx.arc(s.x,s.y,s.sz,0,6.28);cx.fillStyle=`hsla(${hb+20},60%,80%,${Math.max(0,a)})`;cx.fill();});
    shapes.forEach(s=>{s.update();s.draw();});
    ps.forEach(p=>{p.update();p.draw();});
    for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){const dx=ps[i].x-ps[j].x,dy=ps[i].y-ps[j].y,d=Math.sqrt(dx*dx+dy*dy);if(d<110){cx.beginPath();cx.moveTo(ps[i].x,ps[i].y);cx.lineTo(ps[j].x,ps[j].y);cx.strokeStyle=`hsla(${hb},70%,55%,${(1-d/110)*.12})`;cx.lineWidth=.5;cx.stroke();}}
    if(mouse.x!==null)ps.forEach(p=>{const dx=mouse.x-p.x,dy=mouse.y-p.y,d=Math.sqrt(dx*dx+dy*dy);if(d<200){const g=cx.createLinearGradient(p.x,p.y,mouse.x,mouse.y);g.addColorStop(0,`hsla(${hb},80%,60%,0)`);g.addColorStop(1,`hsla(${hb+30},80%,65%,${(1-d/200)*.3})`);cx.beginPath();cx.moveTo(p.x,p.y);cx.lineTo(mouse.x,mouse.y);cx.strokeStyle=g;cx.lineWidth=.7;cx.stroke();}});
    shooters=shooters.filter(s=>s.a>0);shooters.forEach(s=>{s.x+=Math.cos(s.ang)*s.sp;s.y+=Math.sin(s.ang)*s.sp;s.a-=s.dec;const tx=s.x-Math.cos(s.ang)*s.len,ty=s.y-Math.sin(s.ang)*s.len;const g=cx.createLinearGradient(s.x,s.y,tx,ty);g.addColorStop(0,`hsla(${s.h},80%,75%,${s.a})`);g.addColorStop(1,`hsla(${s.h},80%,75%,0)`);cx.beginPath();cx.moveTo(s.x,s.y);cx.lineTo(tx,ty);cx.strokeStyle=g;cx.lineWidth=1.5;cx.stroke();});
    ripples=ripples.filter(r=>r.a>0);ripples.forEach(r=>{r.r+=r.s;r.a-=.008;cx.beginPath();cx.arc(r.x,r.y,r.r,0,6.28);cx.strokeStyle=`hsla(${hb+40},80%,65%,${Math.max(0,r.a)})`;cx.lineWidth=1.5;cx.stroke();});
    hb=(hb+.03)%360;requestAnimationFrame(animate);}
    animate(0);
  }

  function initParallax() {
    const hc = document.querySelector('.hero-content');
    addEventListener('scroll', () => { if(scrollY<innerHeight){hc.style.transform=`translateY(${scrollY*.3}px)`;hc.style.opacity=Math.max(0,1-scrollY/(innerHeight*.8));} });
  }

  window.logout = async function() { if(token)await fetch('/api/auth/logout',{method:'POST',headers:{'Authorization':'Bearer '+token}}); sessionStorage.clear(); location.href='/'; };

  loadPortfolio().then(() => { initParticles(); initStickyNav(); initFloatingNav(); initParallax(); });
})();
