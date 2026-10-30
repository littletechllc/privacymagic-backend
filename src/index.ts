import type { Env } from './env.ts'
import { createHandleRequest } from './handle-request.ts'
import uninstallTemplate from './uninstall.html'

export {
  createHandleRequest,
  isAllowedOrigin,
  isExtensionOrigin,
} from './handle-request.ts'

export const handleRequest = createHandleRequest(uninstallTemplate)

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  },
}
