import { describe, expect, it } from "vitest";
import { INTELLIGENCE_TOOLS, executarTool, encontrarTool } from "@/features/intelligence/tools";
import type { IntelligenceToolContext } from "@/features/intelligence/tools/types";
import type { UsuarioIntelligence } from "@/features/intelligence/types";

function usuario(permissoes: UsuarioIntelligence["permissoes"], papel: "admin" | "usuario" = "usuario"): UsuarioIntelligence {
  return { id: "u1", nome: "Teste", papel, permissoes };
}

// Contexto com supabase intencionalmente quebrado — se a permissão for
// negada corretamente, o handler NUNCA deve chegar a usar isso.
function ctxComUsuario(u: UsuarioIntelligence): IntelligenceToolContext {
  return {
    supabase: {
      from: () => { throw new Error("supabase não deveria ser chamado — permissão deveria ter bloqueado antes."); },
      rpc: () => { throw new Error("supabase não deveria ser chamado — permissão deveria ter bloqueado antes."); },
    } as never,
    usuario: u,
    agora: new Date(2026, 8, 3),
  };
}

describe("Registro de tools (§4/§5)", () => {
  it("caso 1: existem EXATAMENTE as 7 tools aprovadas, nenhuma a mais", () => {
    const nomes = INTELLIGENCE_TOOLS.map((t) => t.name).sort();
    expect(nomes).toEqual([
      "get_deviations", "get_downtime_analysis", "get_economic_summary", "get_employee_analysis",
      "get_factory_overview", "get_forecast_status", "get_production_summary",
    ]);
  });

  it("caso 2: get_machine_analysis e get_product_analysis NÃO existem nesta V1", () => {
    expect(encontrarTool("get_machine_analysis")).toBeUndefined();
    expect(encontrarTool("get_product_analysis")).toBeUndefined();
  });

  it("caso 3: nenhuma tool aceita additionalProperties (schema fechado)", () => {
    INTELLIGENCE_TOOLS.forEach((t) => expect(t.parameters.additionalProperties).toBe(false));
  });
});

describe("Permissões por tool, validadas ANTES de qualquer consulta (§12/§15)", () => {
  it("caso 4: get_factory_overview exige producao_real_historico", async () => {
    const r = await executarTool("get_factory_overview", {}, ctxComUsuario(usuario([])));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.code).toBe("sem_permissao");
  });

  it("caso 5: get_forecast_status exige previsao E producao_real_historico — falta só uma já bloqueia", async () => {
    const rSoHistorico = await executarTool("get_forecast_status", {}, ctxComUsuario(usuario(["producao_real_historico"])));
    expect(rSoHistorico.success).toBe(false);
    const rSoPrevisao = await executarTool("get_forecast_status", {}, ctxComUsuario(usuario(["previsao"])));
    expect(rSoPrevisao.success).toBe(false);
  });

  it("caso 6: get_economic_summary exige financeiro MESMO com producao_real_historico (regra explícita §12)", async () => {
    const r = await executarTool("get_economic_summary", { janela: "semana_atual" }, ctxComUsuario(usuario(["producao_real_historico"])));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.code).toBe("sem_permissao");
      expect(r.message).toContain("financeiro");
    }
  });

  it("caso 7: sem_permissao nunca é representado como dado vazio — sempre code='sem_permissao' com mensagem", async () => {
    const r = await executarTool("get_deviations", {}, ctxComUsuario(usuario([])));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.code).toBe("sem_permissao");
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it("caso 8: admin sempre passa (mesma regra de temPermissao — papel admin bypassa a lista de permissões)", async () => {
    // admin não deveria nem precisar da checagem de sem_permissao — o
    // teste só confirma que a checagem de permissão em si não bloqueia
    // (a consulta real falha depois porque o supabase é um stub — isso é
    // esperado e não é o que este teste avalia).
    const r = await executarTool("get_factory_overview", {}, ctxComUsuario(usuario([], "admin")));
    expect(r.success === false && r.code === "sem_permissao").toBe(false);
  });

  it("caso 9: tool desconhecida devolve erro estruturado, nunca lança exceção", async () => {
    const r = await executarTool("get_something_invented", {}, ctxComUsuario(usuario(["producao_real_historico"])));
    expect(r.success).toBe(false);
  });
});
