/**
 * Generic hook for quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { useQuotaStore } from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import type { QuotaStatusState } from './QuotaCard';
import type { QuotaConfig } from './quotaConfigs';

type QuotaScope = 'page' | 'all';

// After this many consecutive failed background polls, stop masking with last-known-good data
// and surface the real error. At the 60s auto-refresh cadence this is ~3 minutes of grace for
// transient blips before a genuinely broken credential is shown as errored.
const MAX_CONSECUTIVE_SILENT_FAILURES = 3;

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

interface LoadQuotaResult<TData> {
  name: string;
  status: 'success' | 'error';
  data?: TData;
  error?: string;
  errorStatus?: number;
}

export function useQuotaLoader<TState extends QuotaStatusState, TData>(
  config: QuotaConfig<TState, TData>
) {
  const { t } = useTranslation();
  const quota = useQuotaStore(config.storeSelector);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);
  // Per-file count of consecutive silent (background) failures. Used to bound how long a card may
  // keep showing last-known-good data before a persistent error is surfaced.
  const silentFailuresRef = useRef<Record<string, number>>({});

  const loadQuota = useCallback(
    async (
      targets: AuthFileItem[],
      scope: QuotaScope,
      setLoading: (loading: boolean, scope?: QuotaScope | null) => void,
      // Background polls pass silent=true: keep the rendered numbers visible (no loading flash)
      // and preserve last-known-good data on transient errors instead of flipping cards to red.
      silent = false
    ) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;
      // Silent background polls must not touch the section loading flag: doing so flickers the
      // "Refresh All" toolbar button (spinner + disabled) every tick. Only user-initiated loads show it.
      if (!silent) setLoading(true, scope);

      try {
        if (targets.length === 0) return;

        if (!silent) {
          setQuota((prev) => {
            const nextState = { ...prev };
            targets.forEach((file) => {
              nextState[file.name] = config.buildLoadingState();
            });
            return nextState;
          });
        }

        const results = await Promise.all(
          targets.map(async (file): Promise<LoadQuotaResult<TData>> => {
            try {
              const data = await config.fetchQuota(file, t);
              return { name: file.name, status: 'success', data };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              const errorStatus = getStatusFromError(err);
              return { name: file.name, status: 'error', error: message, errorStatus };
            }
          })
        );

        if (requestId !== requestIdRef.current) return;

        setQuota((prev) => {
          const nextState = { ...prev };
          results.forEach((result) => {
            if (result.status === 'success') {
              // Successful poll clears any accumulated silent-failure streak for this file.
              silentFailuresRef.current[result.name] = 0;
              nextState[result.name] = config.buildSuccessState(result.data as TData);
            } else if (
              silent &&
              prev[result.name]?.status === 'success' &&
              (silentFailuresRef.current[result.name] ?? 0) < MAX_CONSECUTIVE_SILENT_FAILURES
            ) {
              // Preserve last-known-good on a background tick, but only for a bounded streak so a
              // genuinely broken credential cannot keep showing stale "success" numbers forever.
              silentFailuresRef.current[result.name] =
                (silentFailuresRef.current[result.name] ?? 0) + 1;
              nextState[result.name] = prev[result.name];
            } else {
              // User-initiated refresh, no good data to keep, or the silent grace window is
              // exhausted: surface the real error and reset the streak.
              silentFailuresRef.current[result.name] = 0;
              nextState[result.name] = config.buildErrorState(
                result.error || t('common.unknown_error'),
                result.errorStatus
              );
            }
          });
          return nextState;
        });
      } finally {
        if (requestId === requestIdRef.current) {
          if (!silent) setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [config, setQuota, t]
  );

  return { quota, loadQuota };
}
