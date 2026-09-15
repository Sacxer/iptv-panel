// MySQL de XtreamUI simulado en memoria: responde a las consultas que hace el migrador.

export function createFakeXtream() {
  const tables = {
    streams_types: [
      { type_id: 1, type_key: 'live' }, { type_id: 2, type_key: 'movie' }, { type_id: 3, type_key: 'created_live' },
      { type_id: 4, type_key: 'radio_streams' }, { type_id: 5, type_key: 'series' },
    ],
    stream_categories: [
      { id: 1, category_type: 'live', category_name: 'Deportes', parent_id: 0, cat_order: 1 },
      { id: 2, category_type: 'movie', category_name: 'Acción', parent_id: 0, cat_order: 1 },
      { id: 3, category_type: 'series', category_name: 'Drama', parent_id: 0, cat_order: 1 },
    ],
    bouquets: [
      { id: 7, bouquet_name: 'Básico', bouquet_channels: '["101","205"]', bouquet_series: '["40"]' },
      { id: 8, bouquet_name: 'Premium', bouquet_channels: '[101,102,205]', bouquet_series: '[]' },
    ],
    streams: [
      { id: 101, type: 1, category_id: 1, stream_display_name: 'Deportes HD', stream_source: '["http://origen.test/dep.ts","http://backup.test/dep.ts"]', stream_icon: 'http://logo/dep.png', channel_id: 'dep.co', target_container: null, added: 1700000000, order: 1, tv_archive_duration: 0 },
      { id: 102, type: 1, category_id: '[1]', stream_display_name: 'Noticias', stream_source: '["http://origen.test/news.m3u8"]', stream_icon: '', channel_id: '', target_container: null, added: 1700000000, order: 2, tv_archive_duration: 0 },
      { id: 205, type: 2, category_id: 2, stream_display_name: 'Película X', stream_source: '["http://origen.test/pelix.mkv"]', stream_icon: '', target_container: '["mkv"]', movie_propeties: '{"plot":"Una peli","rating":"8","movie_image":"http://img/x.jpg"}', added: 1700000100, order: 0, tv_archive_duration: 0 },
      { id: 901, type: 5, category_id: null, stream_display_name: 'Serie A T1E1', stream_source: '["http://origen.test/sa-1-1.mp4"]', target_container: '["mp4"]', movie_propeties: '{"plot":"Piloto"}', added: 1700000200, order: 0, tv_archive_duration: 0 },
      { id: 902, type: 5, category_id: null, stream_display_name: 'Serie A T1E2', stream_source: '["http://origen.test/sa-1-2.mp4"]', target_container: '["mp4"]', movie_propeties: '{}', added: 1700000200, order: 0, tv_archive_duration: 0 },
    ],
    series: [
      { id: 40, title: 'Serie A', category_id: 3, cover: 'http://img/sa.jpg', plot: 'Trama', cast: 'Actor', director: 'Dir', genre: 'Drama', releaseDate: '2020', rating: '7', backdrop_path: '["http://img/bd.jpg"]', youtube_trailer: '', episode_run_time: '45', last_modified: 1700000300 },
    ],
    series_episodes: [
      { id: 1, season_num: 1, series_id: 40, stream_id: 901, sort: 1 },
      { id: 2, season_num: 1, series_id: 40, stream_id: 902, sort: 2 },
    ],
    member_groups: [
      { group_id: 1, is_admin: 1, is_reseller: 0 },
      { group_id: 2, is_admin: 0, is_reseller: 1 },
    ],
    reg_users: [
      { id: 1, username: 'xadmin', member_group_id: 1, status: 1 },
      { id: 2, username: 'revendedor1', member_group_id: 2, status: 1 },
    ],
    users: [
      { id: 500, member_id: 2, username: 'cliente1', password: 'clave1', exp_date: 4102444800, admin_enabled: 1, enabled: 1, admin_notes: 'VIP', reseller_notes: '', bouquet: '["7"]', max_connections: 2, is_trial: 0, created_at: 1690000000, is_mag: 0, is_e2: 0 },
      { id: 501, member_id: 1, username: 'vencido', password: 'clave2', exp_date: 1600000000, admin_enabled: 1, enabled: 1, admin_notes: '', reseller_notes: '', bouquet: '[8]', max_connections: 1, is_trial: 1, created_at: 1590000000, is_mag: 0, is_e2: 0 },
      { id: 502, member_id: 1, username: 'baneado', password: 'clave3', exp_date: null, admin_enabled: 0, enabled: 1, admin_notes: '', reseller_notes: '', bouquet: '[]', max_connections: 1, is_trial: 0, created_at: 1590000000, is_mag: 1, is_e2: 0 },
    ],
  };

  const columns = (name) => (tables[name] ? Object.keys(tables[name][0] || { id: 1 }) : []);
  const typesOf = (sql) => {
    const m = /type IN \(([^)]*)\)/.exec(sql);
    return m ? m[1].split(',').map(Number) : null;
  };
  const afterId = (rows, key, params) => rows.filter((r) => r[key] > (params[0] ?? 0)).sort((a, b) => a[key] - b[key]);

  return {
    tables,
    ended: false,
    async end() {
      this.ended = true;
    },
    async query(sql, params = []) {
      sql = sql.replace(/\s+/g, ' ').trim();
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [columns(params[0]).map((c) => ({ c }))];
      if (sql.startsWith('SELECT type_id, type_key FROM streams_types')) return [tables.streams_types];

      let m = /^SELECT COUNT\(\*\) c FROM (\w+)/.exec(sql);
      if (m) {
        const types = typesOf(sql);
        const rows = tables[m[1]].filter((r) => !types || types.includes(r.type));
        return [[{ c: rows.length }]];
      }
      m = /^SELECT \* FROM (stream_categories|bouquets|series) ORDER BY id$/.exec(sql);
      if (m) return [tables[m[1]]];

      if (sql.startsWith('SELECT * FROM streams WHERE type IN')) {
        const types = typesOf(sql);
        return [afterId(tables.streams.filter((r) => types.includes(r.type)), 'id', params)];
      }
      if (sql.startsWith('SELECT * FROM users')) return [afterId(tables.users, 'id', params)];
      if (sql.startsWith('SELECT e.id AS episode_row_id')) {
        const rows = afterId(tables.series_episodes, 'id', params).map((e) => ({
          ...tables.streams.find((s) => s.id === e.stream_id),
          episode_row_id: e.id, season_num: e.season_num, x_series_id: e.series_id, sort: e.sort,
        }));
        return [rows];
      }
      if (sql.startsWith('SELECT r.*, g.is_admin')) {
        return [tables.reg_users.map((r) => {
          const g = tables.member_groups.find((x) => x.group_id === r.member_group_id) || {};
          return { ...r, g_is_admin: g.is_admin, g_is_reseller: g.is_reseller };
        })];
      }
      throw new Error(`Consulta no soportada por el simulador: ${sql}`);
    },
  };
}
