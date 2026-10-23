/**
 * Estado compartilhado entre as abas do modal de configurações (MAN-02):
 * o elemento do modal aberto e a trava "busy" que impede duas ações
 * ao mesmo tempo (salvar, exportar, importar...). Objeto, e não `let`
 * exportado, porque várias abas alteram os dois.
 */
export const estado = {
  modalEl: null,
  busy: false,
};
