export default defineNuxtRouteMiddleware((to) => {
  if (to.path.startsWith('/admin') && import.meta.client) {
    const token = sessionStorage.getItem('galaxy-admin-token')
    if (!token && to.path !== '/admin') {
      return navigateTo('/admin')
    }
  }
})
