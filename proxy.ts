import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextRequest, NextFetchEvent } from 'next/server';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);

export function proxy(request: NextRequest, event: NextFetchEvent) {
  return clerkMiddleware(async (auth, req) => {
    if (isProtectedRoute(req)) {
      await auth.protect();
    }
  })(request, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|txt|xml)).*)', // txt/xml: robots.txt, sitemap.xml, llms.txt must never wait on auth
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
