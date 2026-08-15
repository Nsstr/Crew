/**
 * Inicializa el gestor de autenticación (falso) para otorgar permisos totales a todos los usuarios.
 * @param {object} app - La instancia de Firebase App.
 * @param {object} state - Objeto de estado global para inyectar el usuario.
 * @param {function} onUserChange - Callback opcional para notificar cambios en la UI.
 */
export function initAuthManager(app, state, onUserChange) {
  // Simular un usuario autenticado con permisos de Administrador
  state.currentUser = {
    uid: "admin_public_user",
    docId: "admin_public_user",
    email: "publico@app",
    nombre: "Usuario Público",
    legajo: "0000",
    rol: "Administrador"
  };

  // Actualiza también window.currentUser para accesibilidad global rápida
  window.currentUser = state.currentUser;

  if (typeof onUserChange === 'function') {
    onUserChange(state.currentUser);
  }
}
