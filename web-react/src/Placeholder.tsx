/**
 * Tela ainda não implementada nesta versão. Não exibe dados: cada tela é portada
 * para React reaproveitando o TypeScript de `@shared/domain`, com o layout do Angular.
 */
export function Placeholder({ title }: { title: string }) {
  return (
    <section className="card border border-base-300 bg-base-100">
      <div className="card-body">
        <h1 className="card-title font-display text-2xl">{title}</h1>
        <p className="text-base-content/70">
          Esta tela ainda não foi portada para a versão React. A versão Oficial em Angular já a oferece completa.
        </p>
      </div>
    </section>
  );
}
