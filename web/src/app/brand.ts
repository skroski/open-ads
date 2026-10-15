/**
 * Marca do painel (white label). Tudo o que identifica quem usa o painel fica aqui:
 * troque este arquivo para usar o painel com o seu nome, sem mexer nas telas.
 */
export interface Brand {
  /** Logo em texto: parte em destaque + parte leve (ex.: "painel" + "ads"). */
  logoStrong: string;
  logoLight: string;
  /**
   * Termos de marca usados quando a conta ainda não tem regras próprias.
   * Prefira cadastrar os termos de cada cliente em Configurações → Regras.
   */
  defaultBrandTerms: string[];
  /**
   * Marcas reconhecidas no nome da conta e das campanhas. Se o nome contém `match`,
   * os `terms` contam como busca de marca. Ex.: { match: ['acme'], terms: ['acme'] }.
   */
  brandHints: Array<{ match: string[]; terms: string[] }>;
  /** Exemplos mostrados nos campos de formulário. */
  examples: {
    accountName: string;
    domain: string;
    contentObjective: string;
  };
}

export const BRAND: Brand = {
  logoStrong: 'Open',
  logoLight: 'Ads',
  defaultBrandTerms: [],
  brandHints: [],
  examples: {
    accountName: 'Cliente Exemplo',
    domain: 'seusite.com.br',
    contentObjective: "ranquear para 'seu serviço principal' e gerar contato",
  },
};

/** Autoria do projeto. Exigida pela licença: mantenha em qualquer cópia ou versão derivada. */
export const AUTHOR = {
  name: 'Daniel Skroski',
};
