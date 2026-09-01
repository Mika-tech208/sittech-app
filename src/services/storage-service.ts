// Camada de dados temporária (Fase 0/1). Implementa a mesma interface
// get/set(key, value, shared) que o sistema original usava via
// `window.storage` dentro do Artifact do Claude.ai, para que o carregamento
// e o salvamento do estado continuem funcionando de forma idêntica fora
// dele — agora sobre localStorage do navegador.
//
// Substituível futuramente por uma implementação sobre Supabase sem
// reescrever as telas: basta trocar a instância exportada abaixo por outra
// que implemente StorageService.

export interface StorageGetResult {
  value: string;
}

export interface StorageService {
  get(key: string, shared?: boolean): Promise<StorageGetResult | null>;
  set(key: string, value: string, shared?: boolean): Promise<boolean>;
}

class LocalStorageService implements StorageService {
  async get(key: string): Promise<StorageGetResult | null> {
    if (typeof window === "undefined") return null;
    const value = window.localStorage.getItem(key);
    if (value === null) return null;
    return { value };
  }

  async set(key: string, value: string): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

export const storageService: StorageService = new LocalStorageService();
