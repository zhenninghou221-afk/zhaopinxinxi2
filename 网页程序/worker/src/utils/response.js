/**
 * Unified JSON response helpers for the Worker API
 */

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 0), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export function success(data, message = 'ok') {
  return json({ success: true, message, data }, 200);
}

export function error(message, status = 400, code = 'ERROR') {
  return json({ success: false, message, code }, status);
}

export function unauthorized(message = '请先登录') {
  return error(message, 401, 'UNAUTHORIZED');
}

export function forbidden(message = '请先订阅以查看完整内容') {
  return error(message, 403, 'FORBIDDEN');
}

export function notFound(message = '未找到') {
  return error(message, 404, 'NOT_FOUND');
}

/**
 * Handle CORS preflight
 */
export function handleCors(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  return null;
}
