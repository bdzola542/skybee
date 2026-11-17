<?php
// Skybee Web Push — раз на хвилину (cron): нові сповіщення й повідомлення в чатах → push на пристрої.
// Запуск: `php /шлях/до/push/cron.php` або `wget -q -O- "https://skybee.online/push/cron.php?key=<cron_key>"`.
require __DIR__ . '/lib.php';
if (PHP_SAPI !== 'cli') {
    $k = cfg()['cron_key'] ?? '';
    if ($k === '' || !hash_equals($k, (string)($_GET['key'] ?? ''))) { http_response_code(403); exit; }
}
@set_time_limit(55);
$started = time();
$lockf = fopen(data_dir() . '/cron.lock', 'c'); // один запуск за раз: повільний не накладається на наступний
if (!$lockf || !flock($lockf, LOCK_EX | LOCK_NB)) exit("busy\n");
foreach (glob(data_dir() . '/rl-*.json') ?: [] as $f) if (filemtime($f) < time() - 3600) @unlink($f); // ліміти запитів старші за годину

const NREASON = [
    'uk' => ['like' => 'вподобав(-ла) ваш пост', 'repost' => 'поширив(-ла) ваш пост', 'follow' => 'стежить за вами', 'reply' => 'відповів(-ла) вам',
        'mention' => 'згадав(-ла) вас', 'quote' => 'процитував(-ла) ваш пост', 'like-via-repost' => 'вподобав(-ла) ваше поширення',
        'repost-via-repost' => 'поширив(-ла) ваше поширення', 'starterpack-joined' => 'приєднався(-лась) через ваш стартовий набір',
        'subscribed-post' => 'опублікував(-ла) новий пост'],
    'en' => ['like' => 'liked your post', 'repost' => 'reposted your post', 'follow' => 'followed you', 'reply' => 'replied to you',
        'mention' => 'mentioned you', 'quote' => 'quoted your post', 'like-via-repost' => 'liked your repost',
        'repost-via-repost' => 'reposted your repost', 'starterpack-joined' => 'joined through your starter pack',
        'subscribed-post' => 'posted'],
];
const WITH_TEXT = ['reply', 'mention', 'quote', 'subscribed-post'];
const SOMEONE = ['uk' => 'Хтось', 'en' => 'Someone'];

function cut(string $s, int $n = 140): string { $s = trim(preg_replace('/\s+/u', ' ', $s)); return mb_strlen($s) > $n ? mb_substr($s, 0, $n - 1) . '…' : $s; }

$files = glob(data_dir() . '/subs/*.json') ?: [];
usort($files, fn($a, $b) => filemtime($a) <=> filemtime($b)); // найдавніше оброблені — першими: повільний акаунт не відбирає чергу в інших
foreach ($files as $file) {
    if (time() - $started > 50) break;
    $r = rec_read($file);
    if (!is_array($r) || empty($r['devices'])) { @unlink($file); continue; }
    try {
    $lang = $r['lang'] ?? 'uk'; $out = [];
    $mark = $r['mark'] ?? ['n' => gmdate('Y-m-d\TH:i:s.000\Z'), 'c' => gmdate('Y-m-d\TH:i:s.000\Z')];

    // 0) заплановані пости: той, чий час настав, спершу знімається зі списку (під замком), потім публікується — двічі не вийде
    foreach ($r['sched'] ?? [] as $it) {
        if ($it['at'] > time()) continue;
        $take = null;
        rec_update($r['did'], function (?array $cur) use ($it, &$take) {
            if (!$cur) return false;
            foreach ($cur['sched'] ?? [] as $k => $x) if ($x['id'] === $it['id']) { $take = $x; unset($cur['sched'][$k]); }
            if (isset($cur['sched'])) $cur['sched'] = array_values($cur['sched']);
            return $cur;
        });
        if (!$take) continue;
        $rec = $take['rec']; $rec['createdAt'] = gmdate('Y-m-d\TH:i:s.000\Z');
        // rkey задано при плануванні: якщо відповідь загубилась після запису, повтор дасть «вже існує», а не другий пост
        $res = xrpc_post($r, 'com.atproto.repo.createRecord', array_filter(['repo' => $r['did'], 'collection' => $rec['$type'], 'rkey' => $take['rkey'] ?? null, 'record' => $rec], fn($v) => $v !== null));
        $ok = $res !== null && ($res[0] === 200 || (($take['tries'] ?? 0) > 0 && $res[0] === 400 && stripos(json_encode($res[1]), 'exist') !== false));
        // нові токени одразу в запис: refresh одноразовий, а далі цикл може піти в continue
        $nj = ['jwt' => $r['jwt'] ?? null, 'refresh' => $r['refresh'] ?? null];
        rec_update($r['did'], function (?array $cur) use ($nj) { if (!$cur) return false; return array_merge($cur, array_filter($nj)); });
        $retry = !$ok && ($res === null ? false : ($res[0] === 0 || $res[0] === 429 || $res[0] >= 500)) && ($take['tries'] ?? 0) < 5 && $take['at'] > time() - 86400;
        if ($retry) { // тимчасовий збій: назад у чергу, наступна спроба за хвилину
            $take['tries'] = ($take['tries'] ?? 0) + 1;
            rec_update($r['did'], function (?array $cur) use ($take) { if (!$cur) return false; $cur['sched'][] = $take; return $cur; });
            continue;
        }
        $body = $ok ? (($lang === 'uk' ? 'Запланований пост опубліковано: ' : 'Scheduled post published: ') . cut((string)$rec['text'], 80))
                    : ($lang === 'uk' ? 'Не вдалося опублікувати запланований пост — перевір пароль застосунку' : 'A scheduled post could not be published — check the app password');
        foreach ($r['devices'] as $dv) push_send($dv['sub'], ['title' => 'Skybee', 'body' => $body, 'hash' => '#/', 'tag' => 'sch-' . $it['id']]);
    }

    // 1) сповіщення
    $n = xrpc($r, 'app.bsky.notification.listNotifications', ['limit' => 30]);
    if ($n === null) { // пароль точно більше не діє (відкликаний): три хвилини поспіль — і запис видаляється
        $f = ($r['fails'] ?? 0) + 1;
        rec_update($r['did'], function (?array $cur) use ($f) { if (!$cur) return false; $cur['fails'] = $f; return $f >= 3 ? false : $cur; });
        continue;
    }
    if ($n[0] !== 200) continue; // тимчасовий збій (мережа, 429, 5xx): пропускаємо цикл, нічого не змінюючи
    $r['fails'] = 0;
    {
        $fresh = array_values(array_filter($n[1]['notifications'] ?? [], fn($x) => ($x['indexedAt'] ?? '') > $mark['n'] && empty($x['isRead'])));
        if ($fresh) {
            $mark['n'] = max(array_map(fn($x) => $x['indexedAt'], $fresh));
            usort($fresh, fn($a, $b) => strcmp($b['indexedAt'], $a['indexedAt']));
            foreach (array_slice($fresh, 0, 4) as $x) {
                $who = ($x['author']['displayName'] ?? '') ?: ('@' . ($x['author']['handle'] ?? '?'));
                $reason = $x['reason'] ?? '';
                $line = NREASON[$lang][$reason] ?? null; if (!$line) continue;
                $body = in_array($reason, WITH_TEXT, true) ? cut((string)($x['record']['text'] ?? '')) : '';
                $out[] = ['title' => "$who $line", 'body' => $body, 'hash' => '#/notifications', 'tag' => 'n-' . substr(sha1($x['uri'] ?? ''), 0, 12)];
            }
            if (count($fresh) > 4) $out[] = ['title' => 'Skybee', 'body' => $lang === 'uk' ? 'І ще ' . (count($fresh) - 4) . ' нових сповіщень' : 'And ' . (count($fresh) - 4) . ' more', 'hash' => '#/notifications', 'tag' => 'n-more'];
        }
    }

    // 2) чати: непрочитані розмови, де остання репліка не моя
    if (!empty($r['chat'])) {
        $c = xrpc($r, 'chat.bsky.convo.listConvos', ['limit' => 20, 'status' => 'accepted'], true);
        if ($c && $c[0] === 200) {
            $maxc = $mark['c'];
            foreach ($c[1]['convos'] ?? [] as $cv) {
                if (empty($cv['id'])) continue;
                $m = $cv['lastMessage'] ?? null;
                if (!$m || ($m['$type'] ?? '') !== 'chat.bsky.convo.defs#messageView' || ($m['sentAt'] ?? '') <= $mark['c']) continue;
                $maxc = max($maxc, $m['sentAt']);
                if (empty($cv['unreadCount']) || !empty($cv['muted']) || ($m['sender']['did'] ?? '') === $r['did']) continue;
                $other = null; foreach ($cv['members'] ?? [] as $mb) if (($mb['did'] ?? '') !== $r['did']) $other = $mb;
                $out[] = ['title' => ($other['displayName'] ?? '') ?: ('@' . ($other['handle'] ?? '?')), 'body' => cut((string)($m['text'] ?? ''), 160),
                    'hash' => '#/messages/' . $cv['id'], 'tag' => 'c-' . $cv['id']];
            }
            $mark['c'] = $maxc;
        } elseif ($c && in_array($c[0], [400, 401, 403], true)) { $r['chat'] = false; } // доступ до чатів відкликали
    }

    // 3) розсилка; мертві підписки (404/410) прибираємо
    $dead = [];
    foreach ($out as $msg) {
        foreach ($r['devices'] as $k => $dv) {
            if (isset($dead[$k])) continue;
            $code = push_send($dv['sub'], $msg);
            if ($code === 404 || $code === 410) $dead[$k] = true;
        }
    }
    // запис перечитується під замком: що додали чи зняли за цей час (підписка, відписка) — не втрачається
    $keep = array_intersect_key($r, array_flip(['jwt', 'refresh', 'fails', 'chat']));
    rec_update($r['did'], function (?array $cur) use ($keep, $mark, $dead) {
        if (!$cur) return false;
        $cur = array_merge($cur, $keep); $cur['mark'] = $mark;
        foreach ($dead as $k => $_) unset($cur['devices'][$k]);
        return $cur['devices'] ? $cur : false;
    });
    } catch (Throwable $e) { // один зіпсований запис чи відповідь не зупиняє решту
        error_log('skybee-push: ' . get_class($e) . ' ' . basename($e->getFile()) . ':' . $e->getLine());
        @touch($file);
    }
}
echo "ok\n";
