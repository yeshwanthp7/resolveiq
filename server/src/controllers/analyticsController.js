import { getDashboardMetrics } from '../services/analyticsService.js';

/**
 * GET /api/v1/analytics/dashboard
 * Returns operational metrics, SLA compliance rates, active breaches,
 * ageing incidents, team workloads, MTTR, and recent audit activity.
 *
 * Query params:
 * - dateRange: 'today' | '7d' | '30d' | '90d' | 'all'
 * - startDate: ISO string
 * - endDate: ISO string
 * - team: string
 * - priority: 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'all'
 */
export async function getDashboard(req, res, next) {
  try {
    const { dateRange, startDate, endDate, team, priority } = req.query;

    const data = await getDashboardMetrics({
      dateRange,
      startDate,
      endDate,
      team,
      priority,
      user: req.user,
    });

    res.status(200).json({
      success: true,
      meta: data.meta,
      metrics: data.metrics,
    });
  } catch (err) {
    next(err);
  }
}
