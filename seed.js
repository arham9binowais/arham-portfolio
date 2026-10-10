// One-time setup script: creates the initial portfolio document in MongoDB.
// Run locally (with .env filled in) BEFORE your first deploy, or against
// your production MONGODB_URI, with:
//
//   node seed.js
//
// It will not overwrite an existing document unless you pass --force:
//
//   node seed.js --force

const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { MongoClient } = require('mongodb');

const env = {};
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) env[k.trim()] = v.join('=').trim();
  });
} catch (e) {}
function getEnv(key, fallback) {
  return process.env[key] || env[key] || fallback;
}

const MONGODB_URI = getEnv('MONGODB_URI', '');
const MONGODB_DB = getEnv('MONGODB_DB', 'portfolio');
const MONGODB_COLLECTION = getEnv('MONGODB_COLLECTION', 'portfolios');

const MONGODB_DNS_SERVERS = getEnv('MONGODB_DNS_SERVERS', '');
if (MONGODB_DNS_SERVERS) dns.setServers(MONGODB_DNS_SERVERS.split(',').map(x => x.trim()).filter(Boolean));

if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Add it to .env (local) or your environment before seeding.');
  process.exit(1);
}

const defaultPortfolio = {
  navigation: [
    { text: 'About', link: '#about' },
    { text: 'Skills', link: '#skills' },
    { text: 'Education', link: '#education' },
    { text: 'Certifications', link: '#certifications' },
    { text: 'Projects', link: '#projects' },
    { text: 'Contact', link: '#contact' }
  ],
  hero: {
    greeting: "Hi, I'm",
    name: 'Arham Bin Owais',
    subtitle: 'I build clean, fast, and thoughtful web experiences.',
    ctaText: 'Get In Touch',
    ctaLink: '#contact',
    resumeText: 'Download Resume',
    resumeLink: '#',
    titles: ['Web Developer', 'Full-Stack Engineer', 'Problem Solver'],
    sectionButtons: []
  },
  about: {
    heading: 'About Me',
    description: "I'm a developer who enjoys turning ideas into working products, from backend logic to polished interfaces.",
    description2: 'Outside of code, I like learning new tools and refining how things work under the hood.',
    stats: [
      { value: '10+', label: 'Projects Completed' },
      { value: '2+', label: 'Years Experience' }
    ],
    sectionButtons: []
  },
  skills: {
    heading: 'Skills',
    categories: [
      { name: 'Frontend', icon: 'fa-laptop-code', items: ['HTML', 'CSS', 'JavaScript'] },
      { name: 'Backend', icon: 'fa-server', items: ['Node.js', 'MongoDB'] }
    ]
  },
  education: {
    heading: 'Education',
    entries: [
      { degree: 'Your Degree', institution: 'Your Institution', year: '2024', description: 'Add a short description here.', id: 'edu-1' }
    ],
    sectionButtons: []
  },
  certifications: {
    heading: 'Certifications',
    items: [
      { name: 'Certification Name', issuer: 'Issuer', date: '2024', id: 'cert-1' }
    ],
    sectionButtons: []
  },
  projects: {
    heading: 'Projects',
    items: [
      { title: 'Project One', description: 'A short description of this project.', tags: ['JavaScript', 'Node.js'], link: '#', highlight: '', id: 'proj-1' }
    ],
    sectionButtons: []
  },
  contact: {
    heading: "Let's Connect",
    description: "Feel free to reach out — I'm always open to new opportunities.",
    email: 'you@example.com',
    phone: '',
    github: 'https://github.com/',
    githubDisplay: 'github.com/yourhandle',
    buttons: [
      { type: 'email', text: 'you@example.com', link: 'mailto:you@example.com' },
      { type: 'github', text: 'github.com/yourhandle', link: 'https://github.com/' }
    ]
  },
  footer: {
    text: '© 2026 Arham Bin Owais. All rights reserved.',
    sectionButtons: []
  },
  customSections: [],
  sectionOrder: ['hero', 'about', 'skills', 'education', 'certifications', 'projects', 'contact']
};

(async () => {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const collection = client.db(MONGODB_DB).collection(MONGODB_COLLECTION);
    const existing = await collection.findOne({ _id: 'main' });
    const force = process.argv.includes('--force');
    if (existing && !force) {
      console.log('A portfolio document already exists. Pass --force to overwrite it.');
      return;
    }
    await collection.replaceOne({ _id: 'main' }, { _id: 'main', ...defaultPortfolio }, { upsert: true });
    console.log(`Seeded portfolio document into ${MONGODB_DB}.${MONGODB_COLLECTION}.`);
  } finally {
    await client.close();
  }
})().catch(e => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
