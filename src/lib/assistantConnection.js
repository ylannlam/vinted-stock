// Admin requests used only to pair the local Assistant PC with its account.
export const vintedWatchRequest=(method='GET',body)=>import('./api').then(m=>m.resourcesRequest(method,body,'?scope=watch'))
