/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * Product-wide Japanese messages for shared states and errors.
 * Screen-specific labels stay with their view until another locale is added.
 */
export const MESSAGES = Object.freeze({
    'action.cancel': 'キャンセル',
    'action.closeNotification': '通知を閉じる',
    'action.execute': '実行する',
    'action.save': '保存',
    'auth.invalidCredentials': 'ユーザー名またはパスワードが正しくありません。',
    'busy.default': '処理中...',
    'data.checking': '接続を確認中',
    'data.error': '取得失敗',
    'data.fresh': '最新 {time}',
    'data.loading': '更新中',
    'data.offline': 'オフライン',
    'error.400': '入力内容を確認してください。',
    'error.401': '認証の有効期限が切れました。もう一度ログインしてください。',
    'error.403': 'この操作を実行する権限がありません。',
    'error.404': '対象のデータが見つかりません。',
    'error.409': 'ほかの変更と競合しました。表示を更新して再試行してください。',
    'error.422': '入力内容を確認してください。',
    'error.500': 'サーバーでエラーが発生しました。しばらくしてから再試行してください。',
    'error.default': '処理に失敗しました。',
    'error.network': 'サーバーに接続できません。接続を確認して再試行してください。',
});

export function message(key, replacements = {}) {
    const template = MESSAGES[key] || key;
    return Object.entries(replacements).reduce(
        (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
        template,
    );
}
