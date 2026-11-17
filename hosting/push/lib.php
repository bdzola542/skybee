<?php
// Skybee Web Push — спільні функції (api.php і cron.php). Лише стандартний PHP: openssl, curl, json.
// Налаштування — config.php (його НЕ в репозиторії: див. config.example.php і README.md).

// помилки й стек із паролями ніколи не виходять назовні (на хостингу може бути display_errors=On)
ini_set('display_errors', '0'); ini_set('zend.exception_ignore_args', '1'); ini_set('log_errors', '1');
set_exception_handler(function ($e) { error_log('skybee-push: ' . get_class($e) . ' ' . basename($e->getFile()) . ':' . $e->getLine()); if (PHP_SAPI !== 'cli') { http_response_code(500); echo '{"error":"server"}'; } exit(1); });
function cfg(): array {
    static $c = null;
    if ($c === null) {
        $f = __DIR__ . '/config.php';
        if (!is_file($f)) { http_response_code(503); exit('{"error":"config"}'); }
        $c = require $f;
        if (strlen((string)base64_decode($c['enc_key'] ?? '')) !== 32 || empty($c['vapid_public']) || empty($c['vapid_private_pem']) || empty($c['subject'])) { http_response_code(503); exit('{"error":"config"}'); }
    }
    return $c;
}
function b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function unb64u(string $s): string { return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

/* ---------- сховище: по файлу на акаунт у data/subs (закрито в .htaccess) ---------- */
function data_dir(): string {
    $d = cfg()['data_dir'] ?? (__DIR__ . '/data'); umask(077);
    if (!is_dir("$d/subs")) mkdir("$d/subs", 0700, true);
    if (!is_file("$d/.htaccess")) @file_put_contents("$d/.htaccess", "Require all denied\n"); // навіть без push/.htaccess дані закриті
    return $d;
}
// ім'я файлу — HMAC від DID (сам DID публічний, хеш без ключа можна обчислити)
function rec_path(string $did): string { return data_dir() . '/subs/' . hash_hmac('sha256', $did, base64_decode(cfg()['enc_key'])) . '.json'; }
// токени сесії теж лежать зашифрованими (refresh живе місяці)
const SEALED = ['jwt', 'refresh'];
function rec_load(string $did): ?array { return rec_read(rec_path($did)); }
function rec_read(string $p): ?array {
    $r = is_file($p) ? json_decode((string)file_get_contents($p), true) : null;
    if (!is_array($r)) return null;
    foreach (SEALED as $k) if (isset($r[$k])) $r[$k] = secret_open((string)$r[$k]);
    return $r;
}
function rec_save(array $r): void {
    foreach (SEALED as $k) if (!empty($r[$k])) $r[$k] = secret_seal((string)$r[$k]); else unset($r[$k]);
    $p = rec_path($r['did']); $t = $p . '.' . bin2hex(random_bytes(4)) . '.tmp';
    file_put_contents($t, json_encode($r, JSON_UNESCAPED_UNICODE), LOCK_EX); chmod($t, 0600); rename($t, $p);
}
function rec_delete(string $did): void { @unlink(rec_path($did)); }
// читання → зміна → запис під замком: cron і api не затирають одне одного (зміна повертає false — запис видалити)
function rec_update(string $did, callable $fn): void {
    $lock = fopen(rec_path($did) . '.lock', 'c'); if (!$lock) return;
    flock($lock, LOCK_EX);
    try { $r = $fn(rec_load($did)); $r ? rec_save($r) : rec_delete($did); }
    finally { flock($lock, LOCK_UN); fclose($lock); }
}

/* ---------- пароль застосунку: AES-256-GCM, ключ лише в config.php ---------- */
function secret_seal(string $plain): string {
    $key = base64_decode(cfg()['enc_key']); $iv = random_bytes(12);
    $ct = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    return b64u($iv . $tag . $ct);
}
function secret_open(string $sealed): ?string {
    $key = base64_decode(cfg()['enc_key']); $raw = unb64u($sealed);
    if (strlen($raw) < 29) return null;
    $r = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return $r === false ? null : $r;
}

/* ---------- HTTP ---------- */
// публічна IP-адреса хоста або null (приватні, loopback, link-local, зарезервовані діапазони — IPv4 і IPv6 — відкидаються)
function public_ip(string $host): ?string {
    if (!preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i', $host)) return null; // без крапки в кінці, без IP-літералів
    $ips = [];
    foreach (@dns_get_record($host, DNS_A | DNS_AAAA) ?: [] as $rec) $ips[] = $rec['ip'] ?? $rec['ipv6'] ?? null;
    if (!$ips) $ips = @gethostbynamel($host) ?: [];
    foreach (array_filter($ips) as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) return $ip;
    }
    return null;
}
// усі запити йдуть на перевірену публічну IP (CURLOPT_RESOLVE: DNS-rebinding не діє), відповідь не більше 1 МБ
function http(string $method, string $url, ?array $json = null, array $headers = [], ?string $raw = null, int $timeout = 8): array {
    $host = strtolower((string)parse_url($url, PHP_URL_HOST)); $ip = $host !== '' ? public_ip($host) : null;
    if (!$ip) return [0, []];
    $ch = curl_init($url);
    $h = $headers;
    if ($json !== null) { $raw = json_encode($json); $h[] = 'Content-Type: application/json'; }
    $body = '';
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_HTTPHEADER => $h, CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_RESOLVE => ["$host:443:" . (str_contains($ip, ':') ? "[$ip]" : $ip)],
        CURLOPT_WRITEFUNCTION => function ($c, $d) use (&$body) { $body .= $d; return strlen($body) > 1048576 ? 0 : strlen($d); }]);
    if ($raw !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $raw);
    curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    return [$code, $body !== '' ? (json_decode($body, true) ?? []) : []];
}

/* ---------- Web Push: VAPID (RFC 8292) і шифрування aes128gcm (RFC 8291) ---------- */
function der_to_raw(string $der): string { // ECDSA DER → R||S по 32 байти
    $o = 2; if (ord($der[1]) & 0x80) $o += ord($der[1]) & 0x7f;
    $rl = ord($der[$o + 1]); $r = substr($der, $o + 2, $rl); $o += 2 + $rl;
    $sl = ord($der[$o + 1]); $s = substr($der, $o + 2, $sl);
    return str_pad(ltrim($r, "\0"), 32, "\0", STR_PAD_LEFT) . str_pad(ltrim($s, "\0"), 32, "\0", STR_PAD_LEFT);
}
function vapid_header(string $endpoint): string {
    $c = cfg(); $u = parse_url($endpoint);
    $aud = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    $head = b64u(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $claims = b64u(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => $c['subject']]));
    openssl_sign("$head.$claims", $sig, $c['vapid_private_pem'], OPENSSL_ALGO_SHA256);
    return 'vapid t=' . "$head.$claims." . b64u(der_to_raw($sig)) . ', k=' . $c['vapid_public'];
}
function ec_pub_pem(string $raw65): string { // 65 байт (0x04‖X‖Y) → PEM SubjectPublicKeyInfo
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $raw65;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}
function sub_keys_ok(string $p256dh, string $auth): bool { // справжня точка на кривій P-256, auth 16 байт
    $ua = unb64u($p256dh);
    return strlen($ua) === 65 && $ua[0] === "\x04" && strlen(unb64u($auth)) === 16 && @openssl_pkey_get_public(ec_pub_pem($ua)) !== false;
}
function push_encrypt(string $payload, string $p256dh, string $auth): string {
    $ua = unb64u($p256dh); $authSecret = unb64u($auth);
    $k = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    $d = openssl_pkey_get_details($k)['ec'];
    $asPub = "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT);
    $secret = openssl_pkey_derive(ec_pub_pem($ua), $k, 32);
    $ikm = hash_hkdf('sha256', $secret, 32, "WebPush: info\0" . $ua . $asPub, $authSecret);
    $salt = random_bytes(16);
    $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
    $ct = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    return $salt . pack('N', 4096) . chr(65) . $asPub . $ct . $tag;
}
// дозволені лише справжні push-сервіси браузерів (інакше сервер можна змусити стукати куди завгодно)
function push_endpoint_ok(string $e): bool {
    $u = parse_url($e);
    if (($u['scheme'] ?? '') !== 'https' || empty($u['host']) || isset($u['port']) || isset($u['user'])) return false;
    if (strlen($e) > 600) return false;
    return (bool)preg_match('/(^|\.)(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/iD', $u['host']);
}
// 2xx — надіслано; 404/410 — підписка мертва (видалити)
function push_send(array $sub, array $msg): int {
    $body = push_encrypt(json_encode($msg, JSON_UNESCAPED_UNICODE), $sub['keys']['p256dh'], $sub['keys']['auth']);
    [$code] = http('POST', $sub['endpoint'], null, [
        'Authorization: ' . vapid_header($sub['endpoint']), 'Content-Encoding: aes128gcm', 'TTL: 86400', 'Urgency: normal',
        'Content-Type: application/octet-stream'], $body, 15);
    return $code;
}

/* ---------- Bluesky ---------- */
// пароль застосунку дає токен зі scope appPass / appPassPrivileged; основний пароль — com.atproto.access (його не приймаємо)
function jwt_scope(string $jwt): string { $p = explode('.', $jwt); return (string)(json_decode(unb64u($p[1] ?? ''), true)['scope'] ?? ''); }
const CHAT_PROXY = 'atproto-proxy: did:web:api.bsky.chat#bsky_chat';
function pds_ok(string $u): bool { // як api.pdsOk у js: лише публічний https-хост
    $p = parse_url($u); $h = strtolower($p['host'] ?? '');
    return ($p['scheme'] ?? '') === 'https' && !isset($p['user']) && !isset($p['port']) && !isset($p['query']) && public_ip($h) !== null
        && !preg_match('/(^|\.)(localhost|local|internal|lan|home|intranet|corp|localdomain|home\.arpa)$/', $h);
}
function resolve_pds(string $handle): ?array { // нік → [did, pds]
    [$c, $d] = http('GET', 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=' . rawurlencode($handle));
    $did = $d['did'] ?? null; if ($c !== 200 || !$did || !str_starts_with($did, 'did:plc:')) return null;
    [$c, $doc] = http('GET', 'https://plc.directory/' . rawurlencode($did));
    foreach (($doc['service'] ?? []) as $s) if (($s['type'] ?? '') === 'AtprotoPersonalDataServer' && pds_ok($s['serviceEndpoint'] ?? '')) return [$did, $s['serviceEndpoint']];
    return null;
}
function login_raw(string $pds, string $id, string $pw): array { // [код, дані]
    return http('POST', "$pds/xrpc/com.atproto.server.createSession", ['identifier' => $id, 'password' => $pw]);
}
function login(string $pds, string $id, string $pw): ?array {
    [$c, $d] = login_raw($pds, $id, $pw);
    return $c === 200 && !empty($d['accessJwt']) ? $d : null;
}
// запит від імені акаунта; сам оновлює токен. null — лише коли пароль точно не діє (400/401 при вході);
// збій мережі, 429 чи 5xx — це [код, []], тож запис не втрачається через тимчасову проблему
function xrpc(array &$r, string $nsid, array $q = [], bool $chat = false): ?array {
    for ($try = 0; $try < 3; $try++) {
        if (empty($r['jwt'])) {
            $pw = secret_open($r['pw']); if (!$pw) return null;
            [$lc, $s] = login_raw($r['pds'], $r['did'], $pw);
            if ($lc === 200 && !empty($s['accessJwt'])) { $r['jwt'] = $s['accessJwt']; $r['refresh'] = $s['refreshJwt']; }
            elseif ($lc === 400 || $lc === 401) return null;
            else return [$lc, []];
        }
        $h = ['Authorization: Bearer ' . $r['jwt']]; if ($chat) $h[] = CHAT_PROXY;
        [$c, $d] = http('GET', $r['pds'] . '/xrpc/' . $nsid . ($q ? '?' . http_build_query($q) : ''), null, $h);
        if ($c === 200) return [$c, $d];
        if ($c === 401 || ($c === 400 && ($d['error'] ?? '') === 'ExpiredToken')) { // токен застарів: оновити, інакше новий вхід
            [$rc, $rd] = http('POST', $r['pds'] . '/xrpc/com.atproto.server.refreshSession', null, ['Authorization: Bearer ' . ($r['refresh'] ?? '')], '');
            if ($rc === 200 && !empty($rd['accessJwt'])) { $r['jwt'] = $rd['accessJwt']; $r['refresh'] = $rd['refreshJwt']; }
            elseif ($rc === 400 || $rc === 401) $r['jwt'] = null; // refresh не діє — новий вхід за паролем
            else return [$rc, []];
            continue;
        }
        return [$c, $d]; // інша помилка (напр. чат без дозволу)
    }
    return null;
}

// POST-запит від імені акаунта (запис поста тощо); сам оновлює токен, як xrpc. null — пароль не діє
function xrpc_post(array &$r, string $nsid, array $body): ?array {
    for ($try = 0; $try < 3; $try++) {
        if (empty($r['jwt'])) {
            $pw = secret_open($r['pw']); if (!$pw) return null;
            [$lc, $s] = login_raw($r['pds'], $r['did'], $pw);
            if ($lc === 200 && !empty($s['accessJwt'])) { $r['jwt'] = $s['accessJwt']; $r['refresh'] = $s['refreshJwt']; }
            elseif ($lc === 400 || $lc === 401) return null;
            else return [$lc, []];
        }
        [$c, $d] = http('POST', $r['pds'] . '/xrpc/' . $nsid, $body, ['Authorization: Bearer ' . $r['jwt']]);
        if ($c === 200) return [$c, $d];
        if ($c === 401 || ($c === 400 && ($d['error'] ?? '') === 'ExpiredToken')) {
            [$rc, $rd] = http('POST', $r['pds'] . '/xrpc/com.atproto.server.refreshSession', null, ['Authorization: Bearer ' . ($r['refresh'] ?? '')], '');
            if ($rc === 200 && !empty($rd['accessJwt'])) { $r['jwt'] = $rd['accessJwt']; $r['refresh'] = $rd['refreshJwt']; }
            elseif ($rc === 400 || $rc === 401) $r['jwt'] = null;
            else return [$rc, []];
            continue;
        }
        return [$c, $d];
    }
    return null;
}

function new_tid(): string { // ключ запису поста (TID): мікросекунди + 10 біт випадкового
    $v = ((int)(microtime(true) * 1e6) << 10) | random_int(0, 1023); $s = '';
    for ($i = 0; $i < 13; $i++) { $s = '234567abcdefghijklmnopqrstuvwxyz'[$v & 31] . $s; $v >>= 5; }
    return $s;
}

/* ---------- заплановані пости: лише текст (+ цитата чи відповідь); тримаються в записі акаунта (поле sched) ---------- */
function strong_ref($x): ?array {
    return is_array($x) && is_string($x['uri'] ?? null) && is_string($x['cid'] ?? null)
        && preg_match('#^at://did:[a-z0-9:.%-]{3,200}/app\.bsky\.feed\.post/[A-Za-z0-9._:~-]{1,512}$#', $x['uri'])
        && preg_match('/^[a-z0-9]{40,100}$/', $x['cid']) ? ['uri' => $x['uri'], 'cid' => $x['cid']] : null;
}
// перевіряє й заново збирає запис поста з довіреного шаблону; null — не пройшло
function sched_record(array $in): ?array {
    $text = $in['text'] ?? null;
    if (!is_string($text) || trim($text) === '' || strlen($text) > 3000) return null;
    if ((function_exists('grapheme_strlen') ? grapheme_strlen($text) : mb_strlen($text)) > 300) return null;
    $rec = ['$type' => 'app.bsky.feed.post', 'text' => $text];
    $langs = array_values(array_filter(array_slice((array)($in['langs'] ?? []), 0, 3), fn($l) => is_string($l) && preg_match('/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/', $l)));
    if ($langs) $rec['langs'] = $langs;
    $len = strlen($text);
    foreach (array_slice((array)($in['facets'] ?? []), 0, 40) as $f) {
        if (!is_array($f) || !is_array($f['features'] ?? null)) continue;
        $i = $f['index'] ?? null; $ft = $f['features'][0] ?? null;
        if (!is_array($i) || !is_array($ft) || !is_int($i['byteStart'] ?? null) || !is_int($i['byteEnd'] ?? null) || $i['byteStart'] < 0 || $i['byteEnd'] > $len || $i['byteStart'] >= $i['byteEnd']) continue;
        $t = $ft['$type'] ?? '';
        if ($t === 'app.bsky.richtext.facet#link' && is_string($ft['uri'] ?? null) && preg_match('#^https?://\S{1,2000}$#', $ft['uri'])) $feat = ['$type' => $t, 'uri' => $ft['uri']];
        elseif ($t === 'app.bsky.richtext.facet#mention' && is_string($ft['did'] ?? null) && preg_match('/^did:[a-z0-9:.%-]{3,200}$/', $ft['did'])) $feat = ['$type' => $t, 'did' => $ft['did']];
        elseif ($t === 'app.bsky.richtext.facet#tag' && is_string($ft['tag'] ?? null) && strlen($ft['tag']) <= 640) $feat = ['$type' => $t, 'tag' => $ft['tag']];
        else continue;
        $rec['facets'][] = ['index' => ['byteStart' => $i['byteStart'], 'byteEnd' => $i['byteEnd']], 'features' => [$feat]];
    }
    if (isset($in['reply'])) {
        if (!is_array($in['reply'])) return null;
        $root = strong_ref($in['reply']['root'] ?? null); $parent = strong_ref($in['reply']['parent'] ?? null);
        if (!$root || !$parent) return null;
        $rec['reply'] = ['root' => $root, 'parent' => $parent];
    }
    if (isset($in['quote'])) {
        $q = strong_ref($in['quote']); if (!$q) return null;
        $rec['embed'] = ['$type' => 'app.bsky.embed.record', 'record' => $q];
    }
    return $rec;
}
