// ---- Utilities ----

function relativeTime(dateStr) {
  if (!dateStr) return '--';
  var date = dateStr.endsWith('Z') ? new Date(dateStr) : new Date(dateStr + 'Z');
  var now = Date.now();
  var diff = now - date.getTime();
  if (diff < 0) return 'just now';
  var secs = Math.floor(diff / 1000);
  if (secs < 60) return secs + 's ago';
  var mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  return days + 'd ago';
}

function formatCost(n) {
  if (n == null) return '$0.00';
  return '$' + Number(n).toFixed(2);
}

function formatDuration(ms) {
  if (ms == null) return '--';
  if (ms < 1000) return ms + 'ms';
  var secs = Math.round(ms / 1000);
  if (secs < 60) return secs + 's';
  var mins = Math.floor(secs / 60);
  var remSecs = secs % 60;
  return mins + 'm ' + remSecs + 's';
}

function formatNumber(n) {
  if (n == null) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function truncAddr(addr, n) {
  n = n || 8;
  if (!addr || addr.length <= n * 2 + 3) return addr || '--';
  return addr.slice(0, n) + '...' + addr.slice(-n);
}

function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function statusBadgeClass(status) {
  return 'pill badge-' + (status || 'pending');
}

function statusBorderClass(status) {
  var map = { active: 'active', completed: 'completed', failed: 'failed', blocked: 'failed' };
  return map[status] || '';
}

async function fetchJSON(url) {
  var res = await fetch(url);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

function debounce(fn, ms) {
  var timer;
  return function() {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

// ---- Clipboard ----

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(function() {
    btn.textContent = 'copied';
    btn.classList.add('copied');
    setTimeout(function() {
      btn.textContent = 'copy';
      btn.classList.remove('copied');
    }, 1500);
  });
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-copy]');
  if (!btn) return;
  e.stopPropagation();
  copyToClipboard(btn.getAttribute('data-copy'), btn);
});

// ---- SSE Connection ----

var sseAnnouncer = null;
var sseRetryDelay = 2000;
var sseMaxDelay = 30000;
var sseConnected = false;
var pollFallbackId = null;
var sseEventSource = null;

// Callbacks that pages can set
var sseCallbacks = {
  onTaskCreated: null,
  onTaskCompleted: null,
  onTaskFailed: null,
  onCycleStarted: null,
  onCycleCompleted: null,
  onSensorRan: null,
  onRefreshAll: null,
};

function announce(msg) {
  if (!sseAnnouncer) sseAnnouncer = document.getElementById('sse-announcer');
  if (!sseAnnouncer) return;
  sseAnnouncer.textContent = '';
  void sseAnnouncer.offsetWidth;
  sseAnnouncer.textContent = msg;
}

function setSSEStatus(connected) {
  sseConnected = connected;
  var dot = document.getElementById('sse-dot');
  if (!dot) return;
  if (connected) {
    dot.className = 'sse-status connected';
    dot.title = 'SSE connected';
    dot.setAttribute('aria-label', 'SSE: connected');
    if (pollFallbackId) { clearInterval(pollFallbackId); pollFallbackId = null; }
  } else {
    dot.className = 'sse-status disconnected';
    dot.title = 'SSE disconnected';
    dot.setAttribute('aria-label', 'SSE: disconnected');
    if (!pollFallbackId && sseCallbacks.onRefreshAll) {
      pollFallbackId = setInterval(sseCallbacks.onRefreshAll, 10000);
    }
  }
}

function connectSSE() {
  var events = new EventSource('/api/events');
  sseEventSource = events;

  events.addEventListener('open', function() {
    setSSEStatus(true);
    sseRetryDelay = 2000;
  });

  events.addEventListener('heartbeat', function() {
    setSSEStatus(true);
  });

  events.addEventListener('task:created', function(e) {
    try {
      var task = JSON.parse(e.data);
      if (sseCallbacks.onTaskCreated) sseCallbacks.onTaskCreated(task);
      refreshStatus();
      announce('New task: ' + (task.subject || 'untitled'));
    } catch(err) { console.error('SSE task:created parse error', err); }
  });

  events.addEventListener('task:completed', function(e) {
    try {
      var task = JSON.parse(e.data);
      if (sseCallbacks.onTaskCompleted) sseCallbacks.onTaskCompleted(task);
      refreshStatus();
      announce('Task completed: ' + (task.subject || '#' + task.id));
    } catch(err) { console.error('SSE task:completed parse error', err); }
  });

  events.addEventListener('task:failed', function(e) {
    try {
      var task = JSON.parse(e.data);
      if (sseCallbacks.onTaskFailed) sseCallbacks.onTaskFailed(task);
      refreshStatus();
      announce('Task failed: ' + (task.subject || '#' + task.id));
    } catch(err) { console.error('SSE task:failed parse error', err); }
  });

  events.addEventListener('cycle:started', function() {
    var dot = document.getElementById('status-dot');
    if (dot) {
      dot.className = 'status-dot live';
      dot.title = 'Dispatch running';
      dot.setAttribute('aria-label', 'Status: dispatch running');
    }
    if (sseCallbacks.onCycleStarted) sseCallbacks.onCycleStarted();
    announce('Dispatch cycle started');
  });

  events.addEventListener('cycle:completed', function(e) {
    try {
      var cycle = JSON.parse(e.data);
      if (sseCallbacks.onCycleCompleted) sseCallbacks.onCycleCompleted(cycle);
      refreshStatus();
      announce('Dispatch cycle completed');
    } catch(err) { console.error('SSE cycle:completed parse error', err); }
  });

  events.addEventListener('sensor:ran', function(e) {
    try {
      var data = JSON.parse(e.data);
      if (sseCallbacks.onSensorRan) sseCallbacks.onSensorRan(data);
    } catch(err) { console.error('SSE sensor:ran parse error', err); }
  });

  events.onerror = function() {
    events.close();
    setSSEStatus(false);
    setTimeout(function() {
      sseRetryDelay = Math.min(sseRetryDelay * 1.5, sseMaxDelay);
      connectSSE();
    }, sseRetryDelay);
  };
}

// ---- Header Updates ----

function updateHeader(status) {
  var costEl = document.getElementById('cost-today');
  if (costEl) costEl.textContent = formatCost(status.cost_today_usd);
  var uptimeEl = document.getElementById('uptime');
  if (uptimeEl) uptimeEl.textContent = status.uptime_hours + 'h uptime';

  var dot = document.getElementById('status-dot');
  if (dot && status.last_cycle) {
    var lastAge = Date.now() - new Date(status.last_cycle.started_at + 'Z').getTime();
    if (lastAge < 5 * 60000) {
      dot.className = 'status-dot live';
      dot.title = 'Last cycle ' + relativeTime(status.last_cycle.started_at);
      dot.setAttribute('aria-label', 'Status: live');
    } else {
      dot.className = 'status-dot offline';
      dot.title = 'Last cycle ' + relativeTime(status.last_cycle.started_at);
      dot.setAttribute('aria-label', 'Status: offline');
    }
  }
}

function refreshStatus() {
  fetchJSON('/api/status').then(function(s) {
    updateHeader(s);
    bumpCostTicker(s.cost_today_usd);
  }).catch(function() {});
}

function bumpCostTicker(newCost) {
  var el = document.getElementById('cost-today');
  if (!el) return;
  var current = parseFloat(el.textContent.replace('$', '')) || 0;
  if (newCost <= current) { el.textContent = formatCost(newCost); return; }

  var ticker = el.parentElement;
  ticker.classList.remove('bump');
  void ticker.offsetWidth;
  ticker.classList.add('bump');

  var start = current;
  var diff = newCost - start;
  var steps = 20;
  var step = 0;
  var iv = setInterval(function() {
    step++;
    var val = start + (diff * (step / steps));
    el.textContent = formatCost(val);
    if (step >= steps) {
      clearInterval(iv);
      el.textContent = formatCost(newCost);
      setTimeout(function() { ticker.classList.remove('bump'); }, 300);
    }
  }, 30);
}

// ---- Identity ----

function loadIdentity(pageName) {
  fetchJSON('/api/identity').then(function(identity) {
    if (!identity) return;
    // Update page title
    document.title = identity.name + ' - ' + pageName;
    // Update header name (preserve status dots)
    var nameEl = document.querySelector('.header-name');
    if (nameEl) {
      var dots = nameEl.querySelectorAll('span');
      nameEl.textContent = identity.name + ' ';
      for (var i = 0; i < dots.length; i++) nameEl.appendChild(dots[i]);
    }
    // Update BNS
    var bnsEl = document.querySelector('.header-bns');
    if (bnsEl) bnsEl.textContent = identity.bns || '';
    // Update avatar fallback letter
    var fallback = document.querySelector('.avatar-fallback');
    if (fallback) fallback.textContent = (identity.name || 'A').charAt(0);
    // Update message input placeholder if present
    var msgInput = document.getElementById('message-input');
    if (msgInput) {
      msgInput.placeholder = 'Send a task to ' + identity.name + '...';
      msgInput.setAttribute('aria-label', 'Send a task to ' + identity.name);
    }
    var msgTitle = document.getElementById('message-title');
    if (msgTitle) msgTitle.textContent = 'Message ' + identity.name;
    // Update footer links
    var footerLinks = document.getElementById('footer-links');
    if (footerLinks && identity.website) {
      var html = '<a href="https://' + identity.website + '" target="_blank" rel="noopener">' + identity.website + '</a>';
      html += ' <span class="footer-dot"></span>';
      footerLinks.innerHTML = html;
    }
  }).catch(function() {});
}

// ---- Message Box ----

// Global function to prefill the message input from any page
function prefillMessage(text) {
  var input = document.getElementById('message-input');
  if (!input) return;
  input.value = text;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  input.focus();
  // Scroll message box into view
  var box = input.closest('.message-box');
  if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function initMessageBox() {
  var form = document.getElementById('message-form');
  var input = document.getElementById('message-input');
  var btn = document.getElementById('message-send');
  var statusEl = document.getElementById('message-status');

  if (!form || !input) return;

  input.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var msg = input.value.trim();
    if (!msg) return;

    btn.disabled = true;
    statusEl.textContent = '';
    statusEl.className = 'message-status';

    var payload = { message: msg };
    if (typeof replyParentId === 'number' && replyParentId > 0) {
      payload.parent_id = replyParentId;
    }

    fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
    .then(function(result) {
      if (result.ok) {
        var replyInfo = (typeof replyParentId === 'number' && replyParentId > 0) ? ' (reply to #' + replyParentId + ')' : '';
        statusEl.textContent = 'Task #' + result.data.id + ' created' + replyInfo;
        statusEl.className = 'message-status ok';
        input.value = '';
        input.style.height = 'auto';
        if (typeof clearReplyContext === 'function') clearReplyContext();
        // If activity page has prependToFeed, use it
        if (typeof prependToFeed === 'function') prependToFeed(result.data);
        refreshStatus();
        setTimeout(function() { statusEl.textContent = ''; }, 3000);
      } else {
        statusEl.textContent = result.data.error || 'Failed to send';
        statusEl.className = 'message-status err';
      }
    })
    .catch(function() {
      statusEl.textContent = 'Network error';
      statusEl.className = 'message-status err';
    })
    .finally(function() { btn.disabled = false; input.focus(); });
  });
}
