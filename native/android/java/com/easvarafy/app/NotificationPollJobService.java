package com.easvarafy.app;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

/**
 * Background poller for admin broadcast notifications (works without FCM).
 *
 * Scheduled with the framework JobScheduler (no extra Gradle dependency):
 * periodic every 15 minutes (Android's minimum) whenever a network is
 * available, persisted across reboots. Each run calls
 * {@link BroadcastNotifier#pollOnce(Context)}.
 */
public class NotificationPollJobService extends JobService {
    private static final String TAG = "EasvarafyNotify";
    public static final int PERIODIC_JOB_ID = 4211;
    public static final int ONE_SHOT_JOB_ID = 4212;
    private static final long PERIOD_MS = 15L * 60L * 1000L;
    private static final long FLEX_MS = 5L * 60L * 1000L;

    private volatile Thread worker;

    @Override
    public boolean onStartJob(final JobParameters params) {
        worker = new Thread(() -> {
            try {
                BroadcastNotifier.pollOnce(getApplicationContext());
            } catch (Throwable t) {
                Log.w(TAG, "poll job crashed: " + t.getMessage());
            } finally {
                jobFinished(params, false);
            }
        }, "easvarafy-notify-poll");
        worker.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Thread t = worker;
        if (t != null) t.interrupt();
        return true;
    }

    /** Idempotent: keeps an existing periodic job instead of resetting its timer. */
    public static boolean schedule(Context ctx) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return false;
        if (js.getPendingJob(PERIODIC_JOB_ID) != null) return true;
        JobInfo job = new JobInfo.Builder(PERIODIC_JOB_ID, new ComponentName(ctx, NotificationPollJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPeriodic(PERIOD_MS, FLEX_MS)
            .setPersisted(true)
            .build();
        try {
            return js.schedule(job) == JobScheduler.RESULT_SUCCESS;
        } catch (Exception e) {
            Log.w(TAG, "schedule failed: " + e.getMessage());
            return false;
        }
    }

    /** One immediate poll (as soon as a network is available). */
    public static void runSoon(Context ctx) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        JobInfo job = new JobInfo.Builder(ONE_SHOT_JOB_ID, new ComponentName(ctx, NotificationPollJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setOverrideDeadline(60_000L)
            .build();
        try {
            js.schedule(job);
        } catch (Exception e) {
            Log.w(TAG, "runSoon failed: " + e.getMessage());
        }
    }

    public static boolean isScheduled(Context ctx) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        return js != null && js.getPendingJob(PERIODIC_JOB_ID) != null;
    }

    public static void cancel(Context ctx) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js != null) js.cancel(PERIODIC_JOB_ID);
    }
}
