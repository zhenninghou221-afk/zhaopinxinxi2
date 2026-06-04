import { success, error } from '../utils/response.js';
import { getActiveSubscription } from '../services/subscription.js';

/**
 * GET /api/v1/companies (public - masked data)
 * Query: ?search=keyword
 * Returns: company_name + locations only (public view)
 */
export async function getCompaniesPublic(request, env) {
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM companies';
    let countQuery = 'SELECT COUNT(*) as total FROM companies';
    const params = [];
    const countParams = [];

    if (search) {
      const where = ' WHERE (company_name LIKE ? OR locations LIKE ?)';
      query += where;
      countQuery += where;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm);
    }

    query += ' ORDER BY row_num ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows, countResult] = await Promise.all([
      env.DB.prepare(query).bind(...params).all(),
      env.DB.prepare(countQuery).bind(...countParams).first(),
    ]);

    // Return masked data: only company_name, locations, tags (public info)
    const maskedRows = rows.results.map(row => ({
      id: row.id,
      row_num: row.row_num,
      company_name: row.company_name,
      locations: row.locations,
      tags_json: row.tags_json,
      // Masked fields - only shown to subscribers
      target_audience: '',
      job_positions: '',
      description: '',
      apply_url: '',
      apply_text: '',
      website_url: row.website_url,
      website_text: row.website_text,
    }));

    const total = countResult ? countResult.total : 0;

    return success({
      companies: maskedRows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Get companies error:', err);
    return error('获取招聘信息失败', 500);
  }
}

/**
 * GET /api/v1/companies/full (authenticated + subscribed)
 * Query: ?search=keyword
 * Returns: ALL fields
 */
export async function getCompaniesFull(request, env, userId) {
  try {
    // Check subscription
    const sub = await getActiveSubscription(env.DB, userId);
    if (!sub) {
      return error('请先订阅以查看完整内容', 403, 'SUBSCRIPTION_REQUIRED');
    }

    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM companies';
    let countQuery = 'SELECT COUNT(*) as total FROM companies';
    const params = [];
    const countParams = [];

    if (search) {
      const where = ` WHERE (
        company_name LIKE ? OR locations LIKE ? OR
        target_audience LIKE ? OR job_positions LIKE ? OR
        description LIKE ? OR tags_json LIKE ?
      )`;
      query += where;
      countQuery += where;
      const searchTerm = `%${search}%`;
      for (let i = 0; i < 6; i++) {
        params.push(searchTerm);
        countParams.push(searchTerm);
      }
    }

    query += ' ORDER BY row_num ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows, countResult] = await Promise.all([
      env.DB.prepare(query).bind(...params).all(),
      env.DB.prepare(countQuery).bind(...countParams).first(),
    ]);

    const total = countResult ? countResult.total : 0;

    return success({
      companies: rows.results,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Get companies full error:', err);
    return error('获取完整信息失败', 500);
  }
}

/**
 * GET /api/v1/companies/all (returns ALL companies at once - for search/filter)
 * Public version
 */
export async function getAllCompaniesPublic(request, env) {
  try {
    const rows = await env.DB.prepare(
      'SELECT id, row_num, company_name, locations, tags_json, website_url, website_text FROM companies ORDER BY row_num ASC'
    ).all();

    return success({
      companies: rows.results,
      total: rows.results.length,
    });
  } catch (err) {
    console.error('Get all companies error:', err);
    return error('获取数据失败', 500);
  }
}

/**
 * GET /api/v1/companies/all-full (returns ALL companies with full fields - for subscribers)
 */
export async function getAllCompaniesFull(request, env, userId) {
  try {
    // Check subscription
    const sub = await getActiveSubscription(env.DB, userId);
    if (!sub) {
      return error('请先订阅以查看完整内容', 403, 'SUBSCRIPTION_REQUIRED');
    }

    const rows = await env.DB.prepare(
      'SELECT * FROM companies ORDER BY row_num ASC'
    ).all();

    return success({
      companies: rows.results,
      total: rows.results.length,
    });
  } catch (err) {
    console.error('Get all companies full error:', err);
    return error('获取数据失败', 500);
  }
}

/**
 * GET /api/v1/companies/stats
 * Returns counts for search chips
 */
export async function getCompanyStats(request, env) {
  try {
    const [total, locations, tags] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as count FROM companies').first(),
      env.DB.prepare('SELECT locations FROM companies').all(),
      env.DB.prepare('SELECT tags_json FROM companies').all(),
    ]);

    // Collect unique cities
    const citySet = new Set();
    for (const row of locations.results) {
      if (row.locations) {
        row.locations.split('/').forEach(city => {
          const c = city.trim();
          if (c) citySet.add(c);
        });
      }
    }

    return success({
      totalCompanies: total ? total.count : 0,
      uniqueCities: citySet.size,
      cities: Array.from(citySet).sort(),
    });
  } catch (err) {
    console.error('Get stats error:', err);
    return error('获取统计失败', 500);
  }
}
