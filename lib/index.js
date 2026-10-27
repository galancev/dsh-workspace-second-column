/**
 * Хост-половина плагина `dsh-workspace-second-column`.
 *
 * Вся работа плагина — в браузере (раскладка сайдбара и переключатель
 * подписей), поэтому хост-половина намеренно пустая: она лишь подтверждает,
 * что пакет смонтирован в профиле как обычный Cordis-плагин.
 * @module dsh-workspace-second-column
 */

/** Стабильное имя Cordis-плагина (совпадает с id в cordis.patch.yml). */
export const name = "workspace-second-column";

/**
 * Смонтировать пустую хост-половину.
 * @param {import('@deepseek-ai/cordis').Context} ctx - контекст хост-плагина.
 */
export function apply(ctx) {
  ctx.logger?.info?.(
    "[workspace-second-column] host half mounted; UI lives in the browser half",
  );
}
