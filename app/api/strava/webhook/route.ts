import { NextRequest, NextResponse } from 'next/server';
import { removeActivityFromAthleteCache } from '@/lib/strava/session';

/**
 * Strava Webhook Subscription Validation Challenge (GET)
 * Echoes hub.challenge when hub.verify_token matches STRAVA_WEBHOOK_VERIFY_TOKEN.
 */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode');
  const token = req.nextUrl.searchParams.get('hub.verify_token');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');

  const expectedToken = (
    process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || 'MY_STRAVA_WEBHOOK_VERIFY_TOKEN'
  ).trim();

  if (mode === 'subscribe' && challenge) {
    if (
      process.env.STRAVA_WEBHOOK_VERIFY_TOKEN &&
      token !== expectedToken
    ) {
      return NextResponse.json({ error: 'Invalid verify_token' }, { status: 403 });
    }
    return NextResponse.json({ 'hub.challenge': challenge }, { status: 200 });
  }

  return NextResponse.json({ error: 'Invalid webhook validation request' }, { status: 400 });
}

interface StravaWebhookEvent {
  object_type: 'activity' | 'athlete';
  object_id: number;
  aspect_type: 'create' | 'update' | 'delete';
  owner_id: number;
  subscription_id?: number;
  event_time?: number;
  updates?: Record<string, unknown>;
}

/**
 * Strava Webhook Event Receiver (POST)
 * Handles activity delete/create/update notifications to keep cached athlete data consistent.
 */
export async function POST(req: NextRequest) {
  try {
    const event = (await req.json()) as StravaWebhookEvent;

    if (event.object_type === 'activity' && event.aspect_type === 'delete') {
      removeActivityFromAthleteCache(event.owner_id, event.object_id);
    }

    if (
      event.object_type === 'athlete' &&
      event.updates &&
      event.updates.authorized === 'false'
    ) {
      // Athlete revoked authorization from Strava settings
      removeActivityFromAthleteCache(event.owner_id, -1);
    }

    // Acknowledge within Strava's 2-second requirement
    return NextResponse.json({ received: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Malformed webhook payload' }, { status: 400 });
  }
}
