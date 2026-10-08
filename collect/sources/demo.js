// Données de démonstration : des sites et des comptes fictifs, pour voir le tableau de bord
// fonctionner avant d'avoir branché quoi que ce soit. Générées de façon reproductible.
import { addDays, dateRange, parseISO } from '../lib/dates.js';
import { mapToDaily, put } from '../lib/series.js';
import { PERIODS } from './searchconsole.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SITES = [
  {
    id: 'sc-domain:maison-aubrac.example', label: 'maison-aubrac.example', base: 310, growth: 0.45, ctr: 0.041, pos: 11.5, weekend: 1.25,
    queries: ['maison aubrac', 'chambre d’hôtes aubrac', 'gîte laguiole', 'week-end aubrac', 'hébergement aubrac', 'chambre d’hôtes aveyron', 'gîte de charme aveyron', 'randonnée aubrac hébergement', 'table d’hôtes aubrac', 'séjour aubrac hiver', 'chambre d’hôtes laguiole', 'gîte groupe aubrac', 'que faire en aubrac', 'aligot table d’hôtes', 'transhumance aubrac dates', 'aubrac en raquettes', 'hôtel de charme aubrac', 'gîte avec spa aveyron'],
    pages: ['/', '/chambres/', '/table-d-hotes/', '/tarifs/', '/sejours/week-end-aubrac/', '/blog/que-faire-en-aubrac/', '/blog/transhumance-dates/', '/acces/', '/sejours/randonnee/', '/contact/', '/blog/aubrac-en-hiver/', '/galerie/'],
  },
  {
    id: 'sc-domain:atelier-ondine.example', label: 'atelier-ondine.example', base: 96, growth: 0.2, ctr: 0.034, pos: 14.2, weekend: 1.1,
    queries: ['atelier ondine', 'cours de céramique lyon', 'stage tournage poterie', 'atelier poterie lyon', 'vaisselle céramique artisanale', 'cours poterie débutant', 'céramiste lyon', 'tasse grès fait main', 'atelier céramique enfant', 'bon cadeau cours poterie', 'émaillage céramique cours', 'assiettes grès artisanales'],
    pages: ['/', '/cours/', '/cours/stage-tournage/', '/boutique/', '/boutique/tasses/', '/bon-cadeau/', '/atelier/', '/contact/', '/journal/choisir-son-argile/'],
  },
  {
    id: 'https://blog.maison-aubrac.example/', label: 'blog.maison-aubrac.example', base: 142, growth: -0.28, ctr: 0.027, pos: 16.8, weekend: 1.15,
    queries: ['recette aligot', 'aligot traditionnel', 'tome fraîche aligot', 'fouace aveyronnaise recette', 'randonnée aubrac boucle', 'plateau de l’aubrac carte', 'fromage laguiole affinage', 'recette estofinade', 'gentiane aubrac', 'burons aubrac ouverts'],
    pages: ['/recette-aligot/', '/fouace-aveyronnaise/', '/randonnees-aubrac/', '/', '/fromage-laguiole/', '/estofinade/', '/burons-ouverts/', '/gentiane/'],
  },
  {
    id: 'sc-domain:leboisclair.example', label: 'leboisclair.example', base: 48, growth: 0.9, ctr: 0.052, pos: 9.4, weekend: 0.7,
    queries: ['le bois clair', 'menuisier sur mesure nantes', 'bibliothèque sur mesure', 'dressing sur mesure nantes', 'menuiserie artisanale nantes', 'meuble sous escalier sur mesure', 'agencement intérieur bois', 'verrière bois atelier', 'plan de travail chêne massif', 'devis menuisier nantes'],
    pages: ['/', '/realisations/', '/bibliotheques/', '/dressings/', '/devis/', '/realisations/sous-escalier/', '/atelier/', '/contact/'],
  },
];

const ACCOUNTS = [
  { id: 'ig:demo-1', network: 'instagram', label: '@maison.aubrac', url: null, followers: 8420, views: 5200, growth: 6.2, rate: 0.048 },
  { id: 'ig:demo-2', network: 'instagram', label: '@atelier.ondine', url: null, followers: 2136, views: 1450, growth: 2.1, rate: 0.071 },
  { id: 'fb:demo-1', network: 'facebook', label: 'Maison Aubrac', url: null, followers: 3910, views: 1900, growth: 1.1, rate: 0.031 },
  { id: 'fb:demo-2', network: 'facebook', label: 'Atelier Ondine', url: null, followers: 1184, views: 520, growth: 0.3, rate: 0.036 },
  { id: 'li:demo-1', network: 'linkedin', label: 'Le Bois Clair', url: null, followers: 642, views: 310, growth: 0.9, rate: 0.058 },
];

const CAPTIONS = [
  ['Reel', 'Premières neiges sur le plateau ce matin, le poêle est allumé.'],
  ['Carrousel', 'La table d’hôtes de samedi : aligot, saucisse et tarte aux myrtilles.'],
  ['Photo', 'Lumière de fin de journée dans la chambre Gentiane.'],
  ['Reel', 'Deux minutes pour comprendre comment se file un aligot.'],
  ['Photo', 'Le troupeau est redescendu, le plateau retrouve son silence.'],
  ['Carrousel', 'Trois boucles de randonnée au départ de la maison.'],
  ['Reel', 'Le petit-déjeuner se prépare : fouace tiède et confitures maison.'],
  ['Photo', 'Brume sur les burons, 7 h 12.'],
  ['Carrousel', 'Avant / après : la grange devenue salon de lecture.'],
  ['Reel', 'Une journée de transhumance vue de l’intérieur.'],
  ['Photo', 'Réouverture des réservations pour le printemps.'],
  ['Photo', 'Le chien de la maison a choisi son fauteuil.'],
];

export function buildDemo(today) {
  const random = rng(20261008);
  const noise = (spread) => 1 + (random() - 0.5) * spread;

  const sites = SITES.map((def) => {
    const lastDate = addDays(today, -3);
    const days = dateRange(addDays(lastDate, -479), lastDate);
    const map = new Map();
    days.forEach((date, i) => {
      const progress = i / (days.length - 1);
      const weekday = new Date(parseISO(date)).getUTCDay();
      const weekly = weekday === 0 || weekday === 6 ? def.weekend : 1;
      const season = 1 + 0.18 * Math.sin((i / 365) * 2 * Math.PI + def.base);
      const clicks = Math.max(0, Math.round(def.base * (1 + def.growth * (progress - 0.5)) * weekly * season * noise(0.3)));
      const ctr = def.ctr * (1 + 0.15 * (progress - 0.5)) * noise(0.2);
      const impressions = Math.round(clicks / ctr) + Math.round(random() * 40);
      const position = Math.max(1.2, def.pos * (1 - 0.18 * def.growth * (progress - 0.5)) * noise(0.08));
      put(map, date, { clicks, impressions, position: Math.round(position * 100) / 100 });
    });

    const total = (from, to, metric) => days.reduce((s, d) => (d >= from && d <= to ? s + map.get(d)[metric] : s), 0);
    const top = {};
    for (const period of PERIODS) {
      const cur = [addDays(lastDate, -(period - 1)), lastDate];
      const prev = [addDays(lastDate, -(2 * period - 1)), addDays(lastDate, -period)];
      const comparable = 2 * period <= 480;
      top[period] = {};
      for (const [name, keys, covered] of [['queries', def.queries, 0.62], ['pages', def.pages, 0.97]]) {
        const weights = keys.map((_, i) => 1 / (i + 1.6) ** 0.9);
        const sum = weights.reduce((a, b) => a + b, 0);
        const clicksNow = total(cur[0], cur[1], 'clicks') * covered;
        const clicksBefore = comparable ? total(prev[0], prev[1], 'clicks') * covered : 0;
        const impressionsNow = total(cur[0], cur[1], 'impressions') * covered;
        top[period][name] = keys.map((k, i) => {
          const share = weights[i] / sum;
          const drift = 1 + (rng(def.base * 31 + i * 7 + name.length)() - 0.5) * 0.7;
          const position = Math.round((1.4 + i * 0.9 + rng(def.base + i)() * 3) * 10) / 10;
          return {
            k: name === 'pages' ? `https://${def.label}${k}` : k,
            c: Math.round(clicksNow * share),
            i: Math.round(impressionsNow * share * (0.7 + i * 0.12)),
            p: position,
            pc: comparable ? Math.round(clicksBefore * share * drift) : null,
            pp: comparable ? Math.round((position + (drift - 1) * 4) * 10) / 10 : null,
          };
        }).sort((a, b) => b.c - a.c);
      }
    }
    return {
      id: def.id, label: def.label, url: null,
      status: { ok: true, message: '', lastDate },
      daily: mapToDaily(map, ['clicks', 'impressions', 'position']),
      top,
    };
  });

  const accounts = ACCOUNTS.map((def) => {
    const lastDate = addDays(today, def.network === 'linkedin' ? -2 : -1);
    const span = def.network === 'instagram' ? 200 : 365;
    const days = dateRange(addDays(lastDate, -(span - 1)), lastDate);
    const map = new Map();
    let followers = def.followers;
    const rows = [];
    for (let i = days.length - 1; i >= 0; i--) {
      const progress = i / (days.length - 1);
      const weekday = new Date(parseISO(days[i])).getUTCDay();
      const weekly = def.network === 'linkedin' ? (weekday === 0 || weekday === 6 ? 0.35 : 1.15) : weekday === 0 ? 1.2 : 1;
      const spike = random() > 0.93 ? 2.4 + random() * 2 : 1;
      const views = Math.round(def.views * (0.75 + 0.5 * progress) * weekly * spike * noise(0.5));
      const reach = Math.round(views * (0.52 + random() * 0.12));
      const interactions = Math.round(views * def.rate * noise(0.5));
      const gained = Math.max(-3, Math.round(def.growth * spike * noise(1.4)));
      rows.push([days[i], { views, reach, interactions, newFollowers: gained, followers }]);
      followers -= gained;
    }
    for (const [date, row] of rows) {
      const extra = def.network === 'linkedin'
        ? { clicks: Math.round(row.interactions * 0.55), likes: Math.round(row.interactions * 0.33), comments: Math.round(row.interactions * 0.07), shares: Math.round(row.interactions * 0.05) }
        : def.network === 'instagram'
          ? { likes: Math.round(row.interactions * 0.78), comments: Math.round(row.interactions * 0.06), shares: Math.round(row.interactions * 0.09), saves: Math.round(row.interactions * 0.07) }
          : {};
      put(map, date, { ...row, ...extra });
    }
    const posts = def.id === 'ig:demo-1' || def.id === 'ig:demo-2'
      ? CAPTIONS.slice(0, def.id === 'ig:demo-1' ? 12 : 8).map(([type, text], i) => {
        const views = Math.round(def.views * (type === 'Reel' ? 3.1 : 1.1) * noise(0.9));
        const interactions = Math.round(views * def.rate * noise(0.6));
        return {
          date: addDays(lastDate, -(i * 3 + 1)), type, text, url: null, views,
          reach: Math.round(views * 0.61), interactions,
          likes: Math.round(interactions * 0.8), comments: Math.round(interactions * 0.06),
        };
      })
      : [];
    return {
      id: def.id, network: def.network, label: def.label, url: def.url, followers: def.followers,
      status: { ok: true, message: '', lastDate },
      daily: mapToDaily(map, ['views', 'reach', 'interactions', 'newFollowers', 'followers', 'clicks', 'likes', 'comments', 'shares', 'saves']),
      posts,
    };
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    demo: true,
    sites,
    accounts,
    sources: {
      searchConsole: { connected: true, ok: true, message: '' },
      meta: { connected: true, ok: true, message: '' },
      linkedin: { connected: true, ok: true, message: '', expiresAt: addDays(today, 41) },
    },
  };
}
