import { forwardAuth } from '../../../../../lib/auth/forward';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function handle(request: Request, context: { params: Promise<{ operation: string[] }> }) {
  return forwardAuth(request, (await context.params).operation.join('/'));
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS, handle as HEAD };
