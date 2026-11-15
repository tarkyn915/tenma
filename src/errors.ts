import type { TranslationKey, TranslationValues } from './i18n';

/** An app-owned error with an English message for logs and localization metadata for the UI. */
export class LocalizedError extends Error {
  constructor(
    readonly key: TranslationKey,
    message: string,
    readonly values: TranslationValues = {}
  ) {
    super(message);
    this.name = 'LocalizedError';
  }
}
