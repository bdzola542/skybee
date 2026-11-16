<?php
// Skybee Web Push — API для сайту: vapid (GET), subscribe, unsubscribe (POST, JSON).
require __DIR__ . '/lib.php';
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    if (!in_array($origin, cfg()['origins'], true)) { http_response_code(403); exit('{"error":"origin"}'); }
    header("Access-Control-Allow-Origin: $origin"); header('Vary: Origin');
    header('Access-Control-Allow-Headers: Content-Type'); header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
function out(array $d, int $code = 200): never { http_response_code($code); echo json_encode($d, JSON_UNESCAPED_UNICODE); exit; }

$a = $_GET['a'] ?? '';
if ($a === 'vapid') out(['key' => cfg()['vapid_public']]);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') out(['error' => 'method'], 405);
$in = json_decode(file_get_contents('php://input', false, null, 0, 16384), true);
if (!is_array($in)) out(['error' => 'json'], 400);

// ліміти спроб входу (пароль приймається лише тут): 12 за годину з адреси (IPv6 — з мережі /64) і 6 за годину на нік
function rate(string $name, int $max): void {
    $f = fopen(data_dir() . '/rl-' . hash('sha256', $name) . '.json', 'c+'); flock($f, LOCK_EX);
    $hits = array_values(array_filter(json_decode((string)stream_get_contents($f), true) ?: [], fn($t) => $t > time() - 3600));
    if (count($hits) >= $max) { flock($f, LOCK_UN); fclose($f); out(['error' => 'rate'], 429); }
    $hits[] = time(); ftruncate($f, 0); rewind($f); fwrite($f, json_encode($hits)); flock($f, LOCK_UN); fclose($f);
}

if ($a === 'subscribe') {
    $ip = $_SERVER['REMOTE_ADDR'] ?? ''; $inet = @inet_pton($ip);
    rate('ip:' . ($inet !== false && strlen($inet) === 16 ? bin2hex(substr($inet, 0, 8)) : $ip), 12);
    $handle = strtolower(trim((string)($in['handle'] ?? ''))); $pw = (string)($in['password'] ?? ''); $s = $in['subscription'] ?? [];
    $ep = (string)($s['endpoint'] ?? ''); $p256 = (string)($s['keys']['p256dh'] ?? ''); $auth = (string)($s['keys']['auth'] ?? '');
    $lang = ($in['lang'] ?? 'uk') === 'uk' ? 'uk' : 'en';
    if (!preg_match('/^[a-z0-9.-]{3,253}$/', ltrim($handle, '@'))) out(['error' => 'handle'], 400);
    $handle = ltrim($handle, '@');
    if ($pw === '' || strlen($pw) > 100 || !push_endpoint_ok($ep) || !sub_keys_ok($p256, $auth)) out(['error' => 'input'], 400);
    rate('h:' . $handle, 6);
    $who = resolve_pds($handle); if (!$who) out(['error' => 'handle'], 400);
    [$did, $pds] = $who;
    $s1 = login($pds, $did, $pw); if (!$s1) out(['error' => 'login'], 401); // неправильний пароль застосунку
    if (!in_array(jwt_scope($s1['accessJwt']), ['com.atproto.appPass', 'com.atproto.appPassPrivileged'], true)) out(['error' => 'mainpw'], 400); // основний пароль не зберігаємо
    $r = ['did' => $did, 'devices' => []];
    $r['handle'] = $s1['handle'] ?? $handle; $r['pds'] = $pds; $r['pw'] = secret_seal($pw); $r['lang'] = $lang;
    $r['jwt'] = $s1['accessJwt']; $r['refresh'] = $s1['refreshJwt']; $r['fails'] = 0;
    $chat = xrpc($r, 'chat.bsky.convo.listConvos', ['limit' => 1], true);
    $r['chat'] = $chat !== null && $chat[0] === 200;
    $now = gmdate('Y-m-d\TH:i:s.000\Z');
    $token = b64u(random_bytes(24));
    $dev = ['sub' => ['endpoint' => $ep, 'keys' => ['p256dh' => $p256, 'auth' => $auth]], 'token' => hash('sha256', $token)];
    rec_update($did, function (?array $cur) use ($r, $dev, $ep, $now) { // під замком: пристрої з інших входів не губляться
        $n = $r; $n['devices'] = $cur['devices'] ?? [];
        $n['mark'] = $cur['mark'] ?? ['n' => $now, 'c' => $now];
        $n['devices'][hash('sha256', $ep)] = $dev;
        if (count($n['devices']) > 5) $n['devices'] = array_slice($n['devices'], -5, null, true);
        return $n;
    });
    $title = $lang === 'uk' ? 'Push увімкнено' : 'Push enabled';
    push_send(['endpoint' => $ep, 'keys' => ['p256dh' => $p256, 'auth' => $auth]], ['title' => 'Skybee', 'body' => $title . ($r['chat'] ? '' : ($lang === 'uk' ? ' (без чатів: у паролі немає доступу до повідомлень)' : ' (no chats: the password has no message access)')), 'hash' => '#/notifications', 'tag' => 'skybee-on']);
    out(['ok' => true, 'did' => $did, 'token' => $token, 'chat' => $r['chat']]);
}
if ($a === 'unsubscribe') {
    $did = (string)($in['did'] ?? ''); $token = (string)($in['token'] ?? '');
    if ($did !== '' && preg_match('/^did:plc:[a-z2-7]{24}$/', $did) && rec_load($did)) {
        rec_update($did, function (?array $r) use ($token) {
            if (!$r) return false;
            foreach ($r['devices'] as $k => $dv) if (hash_equals($dv['token'], hash('sha256', $token))) unset($r['devices'][$k]);
            return $r['devices'] ? $r : false; // без пристроїв пароль на сервері не лишається
        });
    }
    out(['ok' => true]);
}
out(['error' => 'action'], 400);
