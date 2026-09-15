// Migraciones versionadas del esquema. Añade nuevas entradas al final; nunca modifiques las existentes.

const migrations = {
  '001_initial': {
    async up(knex) {
      await knex.schema.createTable('admins', (t) => {
        t.increments('id');
        t.string('username', 64).notNullable().unique();
        t.string('password_hash', 255).notNullable();
        t.string('role', 16).notNullable().defaultTo('admin');
        t.boolean('enabled').notNullable().defaultTo(true);
        t.integer('xtream_id').nullable();
        t.bigInteger('created_at').notNullable();
      });

      await knex.schema.createTable('packages', (t) => {
        t.increments('id');
        t.string('name', 255).notNullable();
        t.text('description');
        t.integer('xtream_id').nullable().index();
        t.bigInteger('created_at').notNullable();
      });

      await knex.schema.createTable('categories', (t) => {
        t.increments('id');
        t.string('name', 255).notNullable();
        t.string('type', 16).notNullable().index();
        t.integer('sort_order').notNullable().defaultTo(0);
        t.integer('xtream_id').nullable().index();
        t.bigInteger('created_at').notNullable();
      });

      await knex.schema.createTable('series', (t) => {
        t.increments('id');
        t.string('name', 512).notNullable();
        t.integer('category_id').unsigned().nullable().references('categories.id').onDelete('SET NULL').index();
        t.text('cover');
        t.text('plot');
        t.text('cast_list');
        t.string('director', 512);
        t.string('genre', 255);
        t.string('release_date', 64);
        t.string('rating', 32);
        t.text('backdrop');
        t.string('youtube_trailer', 255);
        t.string('episode_run_time', 32);
        t.boolean('enabled').notNullable().defaultTo(true);
        t.string('source', 16).notNullable().defaultTo('local');
        t.integer('xtream_id').nullable().index();
        t.bigInteger('created_at').notNullable();
        t.bigInteger('updated_at').notNullable();
      });

      await knex.schema.createTable('streams', (t) => {
        t.increments('id');
        t.string('type', 16).notNullable().index(); // live | movie | episode
        t.string('name', 512).notNullable();
        t.integer('category_id').unsigned().nullable().references('categories.id').onDelete('SET NULL').index();
        t.integer('series_id').unsigned().nullable().references('series.id').onDelete('CASCADE').index();
        t.integer('season').nullable();
        t.integer('episode_num').nullable();
        t.text('logo');
        t.text('source_url');
        t.text('backup_urls');
        t.string('epg_channel_id', 255);
        t.string('container_extension', 16);
        t.integer('tv_archive_duration').notNullable().defaultTo(0);
        t.integer('sort_order').notNullable().defaultTo(0);
        t.boolean('enabled').notNullable().defaultTo(true);
        t.text('info');
        t.string('source', 16).notNullable().defaultTo('local');
        t.integer('xtream_id').nullable().index();
        t.bigInteger('created_at').notNullable();
        t.bigInteger('updated_at').notNullable();
      });

      await knex.schema.createTable('package_streams', (t) => {
        t.integer('package_id').unsigned().notNullable().references('packages.id').onDelete('CASCADE');
        t.integer('stream_id').unsigned().notNullable().references('streams.id').onDelete('CASCADE').index();
        t.primary(['package_id', 'stream_id']);
      });

      await knex.schema.createTable('package_series', (t) => {
        t.integer('package_id').unsigned().notNullable().references('packages.id').onDelete('CASCADE');
        t.integer('series_id').unsigned().notNullable().references('series.id').onDelete('CASCADE').index();
        t.primary(['package_id', 'series_id']);
      });

      await knex.schema.createTable('users', (t) => {
        t.increments('id');
        t.string('username', 128).notNullable().unique();
        t.string('password', 128).notNullable();
        t.string('full_name', 255);
        t.string('email', 255);
        t.string('phone', 64);
        t.bigInteger('exp_date').nullable().index();
        t.integer('max_connections').notNullable().defaultTo(1);
        t.boolean('enabled').notNullable().defaultTo(true);
        t.boolean('suspended').notNullable().defaultTo(false);
        t.text('suspension_reason');
        t.boolean('is_trial').notNullable().defaultTo(false);
        t.text('notes');
        t.integer('owner_id').unsigned().nullable().references('admins.id').onDelete('SET NULL').index();
        t.string('source', 16).notNullable().defaultTo('local');
        t.integer('xtream_id').nullable().index();
        t.bigInteger('last_seen_at').nullable();
        t.string('last_ip', 64);
        t.bigInteger('created_at').notNullable();
        t.bigInteger('updated_at').notNullable();
      });

      await knex.schema.createTable('user_packages', (t) => {
        t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.integer('package_id').unsigned().notNullable().references('packages.id').onDelete('CASCADE').index();
        t.primary(['user_id', 'package_id']);
      });

      await knex.schema.createTable('messages', (t) => {
        t.increments('id');
        t.string('title', 255).notNullable();
        t.text('body');
        t.string('target', 16).notNullable().defaultTo('all');
        t.integer('user_id').unsigned().nullable().references('users.id').onDelete('CASCADE');
        t.integer('package_id').unsigned().nullable().references('packages.id').onDelete('CASCADE');
        t.bigInteger('expires_at').nullable();
        t.integer('created_by').nullable();
        t.bigInteger('created_at').notNullable();
      });

      await knex.schema.createTable('message_reads', (t) => {
        t.integer('message_id').unsigned().notNullable().references('messages.id').onDelete('CASCADE');
        t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
        t.bigInteger('read_at').notNullable();
        t.primary(['message_id', 'user_id']);
      });

      await knex.schema.createTable('notices', (t) => {
        t.increments('id');
        t.string('title', 255).notNullable();
        t.text('body');
        t.string('level', 16).notNullable().defaultTo('info');
        t.string('display', 16).notNullable().defaultTo('banner');
        t.string('target', 16).notNullable().defaultTo('all');
        t.integer('package_id').unsigned().nullable().references('packages.id').onDelete('CASCADE');
        t.bigInteger('starts_at').nullable();
        t.bigInteger('ends_at').nullable();
        t.boolean('active').notNullable().defaultTo(true);
        t.bigInteger('created_at').notNullable();
      });

      await knex.schema.createTable('outages', (t) => {
        t.increments('id');
        t.string('title', 255).notNullable();
        t.text('reason');
        t.string('scope', 16).notNullable().defaultTo('global');
        t.integer('package_id').unsigned().nullable().references('packages.id').onDelete('CASCADE');
        t.bigInteger('starts_at').notNullable();
        t.bigInteger('ends_at').nullable();
        t.boolean('block_playback').notNullable().defaultTo(true);
        t.bigInteger('created_at').notNullable();
      });

      await knex.schema.createTable('connections', (t) => {
        t.increments('id');
        t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE').index();
        t.integer('stream_id').nullable();
        t.string('stream_type', 16);
        t.string('ip', 64);
        t.string('user_agent', 512);
        t.string('mode', 16);
        t.bigInteger('started_at').notNullable();
        t.bigInteger('last_seen_at').notNullable().index();
      });

      await knex.schema.createTable('logs', (t) => {
        t.increments('id');
        t.integer('admin_id').nullable();
        t.string('admin_username', 64);
        t.string('action', 64).notNullable();
        t.string('entity', 32);
        t.string('entity_id', 64);
        t.text('details');
        t.bigInteger('created_at').notNullable().index();
      });

      await knex.schema.createTable('settings', (t) => {
        t.string('key', 64).primary();
        t.text('value');
      });

      await knex.schema.createTable('xtream_jobs', (t) => {
        t.string('id', 32).primary();
        t.string('status', 16).notNullable();
        t.text('progress');
        t.text('stats');
        t.text('log');
        t.text('error');
        t.text('reseller_credentials');
        t.bigInteger('started_at').notNullable();
        t.bigInteger('finished_at').nullable();
      });
    },
    async down() {
      throw new Error('No se permite revertir la migración inicial');
    },
  },
  '002_devices': {
    async up(knex) {
      await knex.schema.createTable('devices', (t) => {
        t.increments('id');
        // Huella para reconocer el equipo: "id:<X-Device-Id>" (apps propias) o "ua:<cliente>:<hash>".
        t.string('uid', 128).nullable().unique();
        t.string('name', 255);
        t.string('type', 16).notNullable().defaultTo('unknown').index();
        t.boolean('type_locked').notNullable().defaultTo(false);
        t.string('brand', 100);
        t.string('model', 255);
        t.string('os', 64);
        t.string('app', 100);
        t.string('mac', 32).index();
        t.string('serial', 100).index();
        t.string('user_agent', 512);
        t.string('ownership', 16).notNullable().defaultTo('unknown').index(); // company | client | unknown
        t.string('inventory_status', 16).notNullable().defaultTo('assigned').index(); // available | assigned | review | retired
        t.integer('user_id').unsigned().nullable().references('users.id').onDelete('SET NULL').index();
        t.integer('last_user_id').unsigned().nullable().references('users.id').onDelete('SET NULL');
        t.string('source', 16).notNullable().defaultTo('auto'); // auto | manual
        t.text('notes');
        t.string('last_ip', 64);
        t.string('last_activity', 32);
        t.bigInteger('first_seen_at').nullable();
        t.bigInteger('last_seen_at').nullable().index();
        t.bigInteger('created_at').notNullable();
        t.bigInteger('updated_at').notNullable();
      });

      await knex.schema.createTable('device_alerts', (t) => {
        t.increments('id');
        t.integer('device_id').unsigned().notNullable().references('devices.id').onDelete('CASCADE').index();
        t.integer('user_id').unsigned().nullable().references('users.id').onDelete('SET NULL');
        t.string('type', 32).notNullable(); // inactive | new_tvbox | foreign_user
        t.text('message');
        t.string('status', 16).notNullable().defaultTo('open').index(); // open | resolved
        t.string('resolution', 255);
        t.integer('resolved_by').nullable();
        t.bigInteger('created_at').notNullable();
        t.bigInteger('resolved_at').nullable();
      });
    },
    async down(knex) {
      await knex.schema.dropTableIfExists('device_alerts');
      await knex.schema.dropTableIfExists('devices');
    },
  },
  '003_stream_health': {
    async up(knex) {
      await knex.schema.alterTable('streams', (t) => {
        t.string('health_status', 16).notNullable().defaultTo('unknown').index(); // online | offline | unknown
        t.bigInteger('health_checked_at').nullable();
        t.integer('health_ms').nullable();
        t.string('health_error', 255).nullable();
        t.integer('health_fail_count').notNullable().defaultTo(0);
        t.bigInteger('health_down_since').nullable();
      });
    },
    async down(knex) {
      await knex.schema.alterTable('streams', (t) => {
        t.dropColumns('health_status', 'health_checked_at', 'health_ms', 'health_error', 'health_fail_count', 'health_down_since');
      });
    },
  },
  '004_billing_reminders_carousel': {
    async up(knex) {
      // Vínculo con plataformas de facturación externas (WispHub u otras) y origen de la suspensión.
      await knex.schema.alterTable('users', (t) => {
        t.string('document_id', 64).nullable().index();
        t.string('external_id', 128).nullable().index();
        t.string('external_status', 64).nullable();
        t.bigInteger('external_synced_at').nullable();
        t.string('suspension_source', 16).nullable(); // manual | external
      });

      await knex.schema.createTable('external_clients', (t) => {
        t.increments('id');
        t.string('provider', 32).notNullable();
        t.string('external_id', 128).notNullable();
        t.string('name', 255);
        t.string('document_id', 64).index();
        t.string('username', 128).index();
        t.string('email', 255);
        t.string('phone', 64);
        t.string('status', 64);
        t.string('plan', 255);
        t.text('raw');
        t.integer('user_id').unsigned().nullable().references('users.id').onDelete('SET NULL').index();
        t.string('link_method', 16); // manual | document | email | phone | username
        t.bigInteger('synced_at').notNullable();
        t.unique(['provider', 'external_id']);
      });

      await knex.schema.createTable('integration_runs', (t) => {
        t.increments('id');
        t.string('provider', 32).notNullable();
        t.string('trigger', 16).notNullable(); // auto | manual | dry_run | webhook
        t.string('status', 16).notNullable(); // running | done | error
        t.text('stats');
        t.text('changes');
        t.text('error');
        t.bigInteger('started_at').notNullable().index();
        t.bigInteger('finished_at').nullable();
      });

      // Recordatorios programados (generan mensajes).
      await knex.schema.createTable('reminders', (t) => {
        t.increments('id');
        t.string('title', 255).notNullable();
        t.text('body');
        t.string('kind', 24).notNullable().defaultTo('general');
        t.string('display', 16).notNullable().defaultTo('inbox'); // inbox | popup
        t.string('target', 16).notNullable().defaultTo('all'); // all | user | package
        t.integer('user_id').unsigned().nullable().references('users.id').onDelete('CASCADE');
        t.integer('package_id').unsigned().nullable().references('packages.id').onDelete('CASCADE');
        t.string('recurrence', 24).notNullable().defaultTo('once'); // once | daily | weekly | monthly | interval | before_expiration
        t.text('config');
        t.integer('message_ttl_days').notNullable().defaultTo(7);
        t.boolean('replace_previous').notNullable().defaultTo(true);
        t.bigInteger('starts_at').nullable();
        t.bigInteger('ends_at').nullable();
        t.boolean('active').notNullable().defaultTo(true);
        t.bigInteger('last_run_at').nullable();
        t.bigInteger('next_run_at').nullable().index();
        t.integer('sent_count').notNullable().defaultTo(0);
        t.integer('created_by').nullable();
        t.bigInteger('created_at').notNullable();
        t.bigInteger('updated_at').notNullable();
      });

      await knex.schema.alterTable('messages', (t) => {
        t.string('kind', 24).notNullable().defaultTo('general');
        t.string('display', 16).notNullable().defaultTo('inbox');
        t.integer('reminder_id').unsigned().nullable().references('reminders.id').onDelete('SET NULL').index();
      });

      // Avisos en carrusel.
      await knex.schema.alterTable('notices', (t) => {
        t.integer('sort_order').notNullable().defaultTo(0);
        t.integer('duration_seconds').nullable();
      });
    },
    async down() {
      throw new Error('Migración 004 no reversible');
    },
  },
  '005_servers_astra_delivery': {
    async up(knex) {
      // Servidores de streaming (nodos con FFmpeg) que reenvían o transcodifican canales.
      await knex.schema.createTable('servers', (t) => {
        t.increments('id');
        t.string('name', 100).notNullable();
        t.string('public_url', 255).notNullable(); // URL con la que los clientes llegan al nodo
        t.string('token', 128).notNullable().unique();
        t.boolean('enabled').notNullable().defaultTo(true);
        t.integer('max_clients').notNullable().defaultTo(0); // 0 = sin límite
        t.integer('weight').notNullable().defaultTo(1);
        t.string('status', 16).notNullable().defaultTo('pending'); // pending | online | offline
        t.bigInteger('last_heartbeat_at').nullable();
        t.string('version', 32);
        t.string('last_ip', 64);
        t.text('hardware');
        t.text('metrics');
        t.text('stream_states');
        t.text('notes');
        t.bigInteger('created_at').notNullable();
        t.bigInteger('updated_at').notNullable();
      });

      await knex.schema.createTable('transcode_profiles', (t) => {
        t.increments('id');
        t.string('name', 100).notNullable();
        t.string('hw', 16).notNullable().defaultTo('cpu'); // cpu | nvenc | qsv | vaapi
        t.string('video_codec', 16).notNullable().defaultTo('h264'); // h264 | hevc
        t.string('preset', 32);
        t.string('resolution', 16).notNullable().defaultTo('source'); // source | 1080 | 720 | 576 | 480 | 360
        t.integer('video_bitrate_kbps').notNullable().defaultTo(3000);
        t.integer('max_bitrate_kbps').nullable();
        t.integer('fps').nullable();
        t.integer('gop').notNullable().defaultTo(50);
        t.boolean('deinterlace').notNullable().defaultTo(false);
        t.string('audio_codec', 16).notNullable().defaultTo('aac'); // copy | aac
        t.integer('audio_bitrate_kbps').notNullable().defaultTo(128);
        t.integer('audio_channels').nullable();
        t.text('extra_args');
        t.bigInteger('created_at').notNullable();
        t.bigInteger('updated_at').notNullable();
      });

      await knex.schema.alterTable('streams', (t) => {
        t.string('delivery_mode', 16).notNullable().defaultTo('default'); // default | direct | restream | transcode
        t.integer('transcode_profile_id').unsigned().nullable().references('transcode_profiles.id').onDelete('SET NULL');
        t.boolean('always_on').notNullable().defaultTo(false);
      });

      await knex.schema.createTable('stream_servers', (t) => {
        t.integer('stream_id').unsigned().notNullable().references('streams.id').onDelete('CASCADE');
        t.integer('server_id').unsigned().notNullable().references('servers.id').onDelete('CASCADE').index();
        t.integer('priority').notNullable().defaultTo(0);
        t.primary(['stream_id', 'server_id']);
      });

      await knex.schema.alterTable('connections', (t) => {
        t.integer('server_id').nullable();
      });

      // Fuentes Astra (Cesbo) conectadas por API.
      await knex.schema.createTable('astra_sources', (t) => {
        t.increments('id');
        t.string('name', 100).notNullable();
        t.string('api_url', 255).notNullable();
        t.string('username', 100);
        t.string('password', 255);
        t.string('play_url', 255); // base para HTTP Play; vacío = api_url
        t.string('url_mode', 16).notNullable().defaultTo('play'); // play | output
        t.string('play_path', 100).notNullable().defaultTo('/play/{id}');
        t.boolean('enabled').notNullable().defaultTo(true);
        t.integer('sync_interval_minutes').notNullable().defaultTo(30);
        t.boolean('status_poll').notNullable().defaultTo(true);
        t.integer('status_interval_minutes').notNullable().defaultTo(5);
        t.boolean('auto_import_new').notNullable().defaultTo(false);
        t.boolean('disable_removed').notNullable().defaultTo(true);
        t.boolean('sync_names').notNullable().defaultTo(false);
        t.text('import_defaults'); // JSON: category_mode, category_id, delivery_mode, transcode_profile_id, server_ids, package_id, always_on
        t.bigInteger('last_sync_at').nullable();
        t.bigInteger('last_status_at').nullable();
        t.text('last_error');
        t.bigInteger('created_at').notNullable();
        t.bigInteger('updated_at').notNullable();
      });

      await knex.schema.createTable('astra_channels', (t) => {
        t.increments('id');
        t.integer('source_id').unsigned().notNullable().references('astra_sources.id').onDelete('CASCADE');
        t.string('astra_id', 64).notNullable();
        t.string('name', 255);
        t.boolean('enabled').notNullable().defaultTo(true);
        t.string('group_name', 255);
        t.text('inputs');
        t.text('outputs');
        t.string('play_url', 512);
        t.integer('stream_id').unsigned().nullable().references('streams.id').onDelete('SET NULL').index();
        t.boolean('removed').notNullable().defaultTo(false);
        t.boolean('onair').nullable();
        t.integer('bitrate_kbps').nullable();
        t.integer('cc_errors').nullable();
        t.integer('sessions').nullable();
        t.bigInteger('status_checked_at').nullable();
        t.bigInteger('synced_at').notNullable();
        t.unique(['source_id', 'astra_id']);
      });
    },
    async down() {
      throw new Error('Migración 005 no reversible');
    },
  },
  '006_device_aliases': {
    async up(knex) {
      // Otras "firmas" (User-Agent sin versión, ID de app) con las que ya se reconoció un mismo equipo.
      await knex.schema.createTable('device_aliases', (t) => {
        t.string('uid', 128).primary();
        t.integer('device_id').unsigned().notNullable().references('devices.id').onDelete('CASCADE').index();
        t.bigInteger('created_at').notNullable();
      });
    },
    async down(knex) {
      await knex.schema.dropTableIfExists('device_aliases');
    },
  },
  '007_epg': {
    async up(knex) {
      await knex.schema.createTable('epg_sources', (t) => {
        t.increments('id');
        t.string('name', 100).notNullable();
        t.text('url').notNullable();
        t.boolean('enabled').notNullable().defaultTo(true);
        t.integer('priority').notNullable().defaultTo(0); // menor = más prioridad cuando dos guías tienen el mismo canal
        t.string('status', 16).notNullable().defaultTo('pending'); // pending | refreshing | ok | error
        t.text('last_error');
        t.integer('channel_count').notNullable().defaultTo(0);
        t.integer('programme_count').notNullable().defaultTo(0);
        t.bigInteger('last_fetch_at').nullable();
        t.bigInteger('created_at').notNullable();
        t.bigInteger('updated_at').notNullable();
      });

      await knex.schema.createTable('epg_channels', (t) => {
        t.increments('id');
        t.integer('source_id').unsigned().notNullable().references('epg_sources.id').onDelete('CASCADE').index();
        t.string('xmltv_id', 255).notNullable().index();
        t.text('display_names'); // JSON
        t.text('icon');
        t.string('country', 8);
        t.text('search_text'); // nombres normalizados para búsqueda
        t.unique(['source_id', 'xmltv_id']);
      });

      await knex.schema.alterTable('streams', (t) => {
        t.integer('epg_match_score').nullable();
        t.boolean('epg_locked').notNullable().defaultTo(false); // asignado a mano: el emparejamiento automático no lo cambia
        t.bigInteger('epg_matched_at').nullable();
      });
    },
    async down() {
      throw new Error('Migración 007 no reversible');
    },
  },
  '008_epg_programmes': {
    async up(knex) {
      // Programación de los canales usados (ventana corta) para "ahora / siguiente" en las apps.
      await knex.schema.createTable('epg_programmes', (t) => {
        t.increments('id');
        t.string('channel_id', 255).notNullable();
        t.bigInteger('start').notNullable();
        t.bigInteger('stop').notNullable();
        t.text('title');
        t.text('description');
        t.string('lang', 8);
        t.integer('batch').notNullable().defaultTo(0);
        t.index(['channel_id', 'start']);
        t.index(['batch']);
      });
      // Vigencia de cada guía: detectar fuentes con programación vieja.
      await knex.schema.alterTable('epg_sources', (t) => {
        t.bigInteger('first_programme_at').nullable();
        t.bigInteger('last_programme_at').nullable();
        t.integer('current_programmes').notNullable().defaultTo(0);
      });
    },
    async down(knex) {
      await knex.schema.dropTableIfExists('epg_programmes');
    },
  },
  '009_server_network': {
    async up(knex) {
      await knex.schema.alterTable('servers', (t) => {
        t.text('network'); // puertos de red que informa el nodo
      });
    },
    async down(knex) {
      await knex.schema.alterTable('servers', (t) => t.dropColumn('network'));
    },
  },
  '010_backups': {
    async up(knex) {
      // Copias de seguridad hechas en este servidor. La tabla no se incluye en los propios backups.
      await knex.schema.createTable('backups', (t) => {
        t.increments('id');
        t.string('filename', 255).notNullable();
        t.bigInteger('size').notNullable().defaultTo(0);
        t.string('sha256', 64);
        t.string('status', 16).notNullable().defaultTo('running'); // running | ok | error
        t.text('error');
        t.string('trigger', 16).notNullable().defaultTo('manual'); // manual | scheduled | pre_restore | upload | drive
        t.string('note', 255);
        t.boolean('encrypted').notNullable().defaultTo(false);
        t.boolean('pinned').notNullable().defaultTo(false); // la limpieza automática no la borra
        t.string('app_version', 32);
        t.text('meta'); // JSON: tablas y filas, migraciones, opciones
        t.string('created_by', 64);
        t.bigInteger('created_at').notNullable().index();
        t.bigInteger('finished_at');
        t.bigInteger('local_deleted_at'); // el archivo local se borró (puede seguir en Drive)
        t.string('drive_file_id', 128);
        t.string('drive_status', 16).notNullable().defaultTo('none'); // none | pending | uploading | ok | error
        t.text('drive_error');
        t.integer('drive_attempts').notNullable().defaultTo(0);
        t.bigInteger('drive_uploaded_at');
        t.bigInteger('restored_at');
      });
    },
    async down(knex) {
      await knex.schema.dropTableIfExists('backups');
    },
  },
  '011_app_releases': {
    async up(knex) {
      // Versiones de la app propia que se reparten desde el portal (TV box sin Play Store).
      await knex.schema.createTable('app_releases', (t) => {
        t.increments('id');
        t.string('package_name', 128).notNullable().index();
        t.string('version_name', 64).notNullable();
        t.integer('version_code').notNullable().defaultTo(0); // el mayor de sus archivos
        t.string('channel', 16).notNullable().defaultTo('stable'); // stable | beta
        t.text('notes');
        t.boolean('mandatory').notNullable().defaultTo(false);
        t.boolean('published').notNullable().defaultTo(false);
        t.text('targets'); // JSON: tipos de equipo (tvbox, tv, phone…); vacío = todos
        t.integer('rollout_percent').notNullable().defaultTo(100);
        t.integer('min_sdk');
        t.integer('target_sdk');
        t.string('created_by', 64);
        t.bigInteger('created_at').notNullable();
        t.bigInteger('updated_at').notNullable();
        t.bigInteger('published_at');
        t.unique(['package_name', 'version_name']);
      });
      await knex.schema.createTable('app_release_files', (t) => {
        t.increments('id');
        t.integer('release_id').unsigned().notNullable().references('app_releases.id').onDelete('CASCADE').index();
        t.string('abi', 16).notNullable(); // arm64-v8a | armeabi-v7a | x86_64 | x86 | universal | none
        t.integer('version_code').notNullable();
        t.string('filename', 255).notNullable();
        t.bigInteger('size').notNullable().defaultTo(0);
        t.string('sha256', 64);
        t.integer('downloads').notNullable().defaultTo(0);
        t.bigInteger('created_at').notNullable();
        t.unique(['release_id', 'abi']);
      });
      await knex.schema.alterTable('devices', (t) => {
        t.string('app_version', 32); // versión de la app propia instalada (X-App-Version)
        t.integer('app_build'); // versionCode (X-App-Build)
        t.string('app_distribution', 16); // play | portal (X-App-Distribution)
      });
    },
    async down(knex) {
      await knex.schema.alterTable('devices', (t) => {
        t.dropColumn('app_version');
        t.dropColumn('app_build');
        t.dropColumn('app_distribution');
      });
      await knex.schema.dropTableIfExists('app_release_files');
      await knex.schema.dropTableIfExists('app_releases');
    },
  },
};

export const migrationSource = {
  async getMigrations() {
    return Object.keys(migrations).sort();
  },
  getMigrationName(name) {
    return name;
  },
  async getMigration(name) {
    return migrations[name];
  },
};
