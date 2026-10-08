// Meta : pages Facebook et comptes Instagram professionnels qui y sont rattachés.
// Un seul jeton (utilisateur système de Meta Business Suite) donne accès à tous les
// comptes qui lui sont attribués ; ils sont découverts automatiquement.
import { request, mapLimit } from '../lib/http.js';
import { addDays, chunkRange, dateRange, maxDate, toISO, zonedMidnight, DAY } from '../lib/dates.js';
import { dailyToMap, mapToDaily, mergeInto, put, lastDateWith } from '../lib/series.js';

const METRICS = ['views', 'reach', 'interactions', 'newFollowers', 'followers', 'likes', 'comments', 'shares', 'saves'];
const META_TZ = 'America/Los_Angeles';
const INVALID_METRIC = 100; // code d'erreur Meta « paramètre invalide » (métrique retirée, par exemple)

// Métriques de page Facebook -> nom utilisé dans le tableau de bord.
const FB_METRICS = {
  page_media_view: 'views',
  page_total_media_view_unique: 'reach',
  page_post_engagements: 'interactions',
  page_daily_follows_unique: 'follows',
  page_daily_unfollows_unique: 'unfollows',
  page_follows: 'followers',
};
// Métriques de compte Instagram (totaux par jour).
const IG_METRICS = {
  views: 'views', reach: 'reach', total_interactions: 'interactions',
  likes: 'likes', comments: 'comments', shares: 'shares', saves: 'saves',
};
const igType = (m) => {
  if (m.media_product_type === 'REELS') return 'Reel';
  if (m.media_product_type === 'STORY') return 'Story';
  if (m.media_type === 'CAROUSEL_ALBUM') return 'Carrousel';
  return m.media_type === 'VIDEO' ? 'Vidéo' : 'Photo';
};

// Meta date chaque valeur par la fin de la journée (minuit, heure du Pacifique) :
// on recule de 12 h pour retomber sur le jour mesuré.
const dayOf = (endTime) => toISO(Date.parse(endTime) - DAY / 2);
const num = (v) => (typeof v === 'number' ? v : undefined);

export async function collectMeta({ token, config, existing, today, log }) {
  const version = config.apiVersion || 'v25.0';
  const exclude = new Set(config.exclude || []);
  const labels = config.labels || {};
  const yesterday = addDays(today, -1);

  const graph = (path, params = {}, accessToken = token) => {
    const qs = new URLSearchParams(params).toString();
    return request(`https://graph.facebook.com/${version}/${path}${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  };

  // 1. Pages accessibles et compte Instagram lié à chacune.
  const pages = [];
  let after;
  do {
    const res = await graph('me/accounts', {
      fields: 'id,name,link,followers_count,fan_count,access_token,instagram_business_account{id,username,name,followers_count,media_count}',
      limit: 100,
      ...(after ? { after } : {}),
    });
    pages.push(...(res.data || []));
    after = res.paging && res.paging.next && res.paging.cursors ? res.paging.cursors.after : null;
  } while (after);
  log(`Meta : ${pages.length} page(s) Facebook, ${pages.filter((p) => p.instagram_business_account).length} compte(s) Instagram.`);

  const accounts = [];

  for (const page of pages) {
    const pageToken = page.access_token || token;

    // ----- Page Facebook -----
    const fbId = `fb:${page.id}`;
    if (!exclude.has(fbId)) {
      const previous = existing.get(fbId);
      const map = dailyToMap(previous && previous.daily);
      const account = {
        id: fbId, network: 'facebook',
        label: labels[fbId] || page.name,
        url: page.link || `https://www.facebook.com/${page.id}`,
        followers: num(page.followers_count) ?? num(page.fan_count) ?? null,
        status: { ok: true, message: '', lastDate: null },
        posts: [],
      };
      try {
        const last = lastDateWith(map, 'views');
        const start = last ? addDays(last, -3) : addDays(today, -(config.backfillFacebook || 365));
        let names = Object.keys(FB_METRICS);
        const missing = [];
        const fresh = new Map();
        const follows = new Map();
        for (const [from, to] of chunkRange(start, yesterday, 88)) {
          const params = { period: 'day', since: from, until: addDays(to, 2) };
          let series;
          try {
            series = (await graph(`${page.id}/insights`, { ...params, metric: names.join(',') }, pageToken)).data || [];
          } catch (e) {
            if (!(e.body && e.body.error && e.body.error.code === INVALID_METRIC)) throw e;
            // Une métrique n'existe plus : on les demande une à une et on garde celles qui répondent.
            series = [];
            const kept = [];
            for (const name of names) {
              try {
                series.push(...((await graph(`${page.id}/insights`, { ...params, metric: name }, pageToken)).data || []));
                kept.push(name);
              } catch (inner) {
                if (!(inner.body && inner.body.error && inner.body.error.code === INVALID_METRIC)) throw inner;
                missing.push(name);
              }
            }
            names = kept;
          }
          for (const s of series) {
            const key = FB_METRICS[s.name];
            if (!key || s.period !== 'day') continue;
            for (const point of s.values || []) {
              if (typeof point.value !== 'number' || !point.end_time) continue;
              const date = dayOf(point.end_time);
              if (date > yesterday) continue;
              if (key === 'follows' || key === 'unfollows') {
                follows.set(date, { ...(follows.get(date) || {}), [key]: point.value });
              } else {
                put(fresh, date, { [key]: point.value });
              }
            }
          }
        }
        for (const [date, f] of follows) put(fresh, date, { newFollowers: (f.follows || 0) - (f.unfollows || 0) });
        mergeInto(map, fresh);
        if (missing.length) account.status.message = `Indicateurs indisponibles chez Meta : ${missing.join(', ')}.`;
        if (!fresh.size && !last) account.status.message = 'Aucune statistique renvoyée (Meta en fournit à partir de 100 mentions J’aime).';
      } catch (e) {
        account.status.ok = false;
        account.status.message = e.message;
        log(`  ! Facebook ${account.label} : ${e.message}`);
      }
      account.daily = mapToDaily(map, METRICS);
      account.status.lastDate = lastDateWith(map, 'views');
      accounts.push(account);
    }

    // ----- Compte Instagram lié -----
    const ig = page.instagram_business_account;
    if (!ig || exclude.has(`ig:${ig.id}`)) continue;
    const igId = `ig:${ig.id}`;
    const previous = existing.get(igId);
    const map = dailyToMap(previous && previous.daily);
    const account = {
      id: igId, network: 'instagram',
      label: labels[igId] || (ig.username ? `@${ig.username}` : ig.name || 'Instagram'),
      url: ig.username ? `https://www.instagram.com/${ig.username}/` : null,
      followers: num(ig.followers_count) ?? null,
      status: { ok: true, message: '', lastDate: null },
      posts: previous ? previous.posts || [] : [],
    };
    try {
      const last = lastDateWith(map, 'views');
      const start = last ? addDays(last, -3) : addDays(today, -(config.backfillInstagram || 90));
      const days = dateRange(maxDate(start, addDays(today, -700)), yesterday);
      let names = Object.keys(IG_METRICS);
      const fresh = new Map();

      const fetchDay = async (date, metricNames) => {
        const since = Math.floor(zonedMidnight(date, META_TZ) / 1000);
        const res = await graph(`${ig.id}/insights`, {
          metric: metricNames.join(','), period: 'day', metric_type: 'total_value', since, until: since + 86400,
        }, pageToken);
        const values = {};
        for (const item of res.data || []) {
          const key = IG_METRICS[item.name];
          if (key && item.total_value && typeof item.total_value.value === 'number') values[key] = item.total_value.value;
        }
        return values;
      };

      // Premier appel : si Meta refuse la liste complète, on repère les indicateurs encore disponibles.
      if (days.length) {
        const probe = days[days.length - 1];
        try {
          put(fresh, probe, await fetchDay(probe, names));
        } catch (e) {
          if (!(e.body && e.body.error && e.body.error.code === INVALID_METRIC)) throw e;
          const kept = [];
          for (const name of names) {
            try { put(fresh, probe, await fetchDay(probe, [name])); kept.push(name); } catch { /* indicateur retiré */ }
          }
          if (!kept.length) throw e;
          account.status.message = `Indicateurs indisponibles chez Meta : ${names.filter((n) => !kept.includes(n)).join(', ')}.`;
          names = kept;
        }
        let failures = 0;
        await mapLimit(days.slice(0, -1), 3, async (date) => {
          try { put(fresh, date, await fetchDay(date, names)); } catch (e) { failures++; if (failures === 1) log(`  ! Instagram ${account.label}, ${date} : ${e.message}`); }
        });
        if (failures) account.status.message = `${failures} jour(s) n’ont pas pu être lus ; ils seront retentés à la prochaine mise à jour.`;
      }

      // Nouveaux abonnés par jour (Meta ne fournit que les 30 derniers jours, à partir de 100 abonnés).
      try {
        const until = Math.floor(zonedMidnight(today, META_TZ) / 1000);
        const res = await graph(`${ig.id}/insights`, { metric: 'follower_count', period: 'day', since: until - 29 * 86400, until }, pageToken);
        for (const s of res.data || []) {
          for (const point of s.values || []) {
            if (typeof point.value === 'number' && point.end_time) put(fresh, dayOf(point.end_time), { newFollowers: point.value });
          }
        }
      } catch { /* compte de moins de 100 abonnés : pas de détail quotidien */ }

      if (account.followers !== null) put(fresh, yesterday, { followers: account.followers });
      mergeInto(map, fresh);

      // Dernières publications et leurs résultats.
      try {
      const media = await graph(`${ig.id}/media`, {
        fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count', limit: 12,
      }, pageToken);
      account.posts = await mapLimit(media.data || [], 3, async (m) => {
        const post = {
          date: (m.timestamp || '').slice(0, 10),
          type: igType(m),
          text: (m.caption || '').replace(/\s+/g, ' ').trim().slice(0, 140),
          url: m.permalink || null,
          views: null, reach: null,
          likes: num(m.like_count) ?? null, comments: num(m.comments_count) ?? null,
          interactions: (num(m.like_count) ?? 0) + (num(m.comments_count) ?? 0),
        };
        for (const metric of ['views,reach,total_interactions', 'reach,total_interactions']) {
          try {
            const res = await graph(`${m.id}/insights`, { metric }, pageToken);
            for (const item of res.data || []) {
              const value = item.values && item.values[0] ? item.values[0].value : item.total_value && item.total_value.value;
              if (typeof value !== 'number') continue;
              if (item.name === 'views') post.views = value;
              if (item.name === 'reach') post.reach = value;
              if (item.name === 'total_interactions') post.interactions = value;
            }
            break;
          } catch { /* on tente la liste réduite, puis on garde les mentions J'aime et commentaires */ }
        }
        return post;
      });
      } catch (e) {
        log(`  ! Instagram ${account.label}, publications : ${e.message}`);
      }
    } catch (e) {
      account.status.ok = false;
      account.status.message = e.message;
      log(`  ! Instagram ${account.label} : ${e.message}`);
    }
    account.daily = mapToDaily(map, METRICS);
    account.status.lastDate = lastDateWith(map, 'views');
    accounts.push(account);
  }

  return { entities: accounts, source: { connected: true, ok: true, message: '' } };
}
