/**
 * Marca do painel (white label). Tudo o que identifica quem usa o painel fica aqui:
 * troque este arquivo para usar o painel com o seu nome, sem mexer nas telas.
 */
export interface BrandLogos {
  /** Símbolo para fundo claro (anel escuro) */
  symbolDark: string;
  /** Símbolo para fundo escuro (anel claro) */
  symbolLight: string;
  /** Logo expandido para fundo claro (texto escuro) */
  expandedDark: string;
  /** Logo expandido para fundo escuro (texto claro) */
  expandedLight: string;
}

export interface Brand {
  /** Logo em texto: parte em destaque + parte leve (ex.: "painel" + "ads"). */
  logoStrong: string;
  logoLight: string;
  /** Logos da marca (expandido e símbolo, versões para fundo claro e escuro). */
  logos: BrandLogos;
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
  logos: {
    symbolDark: '/brand/logo-symbol-dark.png',
    symbolLight: '/brand/logo-symbol-light.png',
    expandedDark: '/brand/logo-expanded-dark.png',
    expandedLight: '/brand/logo-expanded-light.png',
  },
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

/** Apoio e doações voluntárias ao projeto OpenAds. */
export const DONATION = {
  pixKey: '41999865410',
  pixType: 'Telefone',
  message:
    'Qualquer valor, se este sistema te ajudou a economizar, ajuda para melhorar ainda mais. Nunca vai ser obrigação: o projeto é e sempre será 100% open source e gratuito!',
};

