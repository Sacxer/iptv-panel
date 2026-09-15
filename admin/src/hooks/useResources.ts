import { useMemo } from 'react';
import { api, asList } from '../api';
import type { AdminAccount, Category, CategoryType, Package } from '../types';
import { useAsync } from './useAsync';

export function usePackages() {
  const state = useAsync<Package[]>(async () => asList(await api.packages.list()), []);
  const packages = state.data ?? [];
  const byId = useMemo(() => new Map(packages.map((p) => [p.id, p])), [packages]);
  return { ...state, packages, byId };
}

export function useCategories(type?: CategoryType) {
  const state = useAsync<Category[]>(async () => {
    const list = asList(await api.categories.list(type));
    return [...list].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [type]);
  const categories = state.data ?? [];
  return { ...state, categories };
}

/** Lista de administradores/revendedores; solo se solicita si `enabled`. */
export function useAdmins(enabled: boolean) {
  const state = useAsync<AdminAccount[]>(
    async () => (enabled ? asList(await api.admins.list()) : []),
    [enabled],
  );
  return { ...state, admins: state.data ?? [] };
}
