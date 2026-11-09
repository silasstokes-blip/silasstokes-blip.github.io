/* Small progressive enhancements. Every page reads fine without this file. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var framed = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();

  /* Open each page at the top. Some viewers carry the previous page's scroll position over,
     either inside this page or in the frame that holds it. Links to a section (#work, #contact)
     and back/forward navigation keep their position. */
  (function startAtTop() {
    var entry = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
    if (location.hash || entry.type === 'back_forward' || entry.type === 'reload') return;
    var touched = false, frameDone = !framed;
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (ev) {
      window.addEventListener(ev, function () { touched = true; }, { once: true, passive: true });
    });
    var toTop = function () {
      if (touched) return;
      if (window.scrollY > 0) window.scrollTo(0, 0);
      if (!frameDone) {
        // In a viewer that sizes its frame to the page, the scrolling happens outside this
        // document; bringing the page's first element into view scrolls that container too.
        frameDone = true;
        var first = document.querySelector('header') || document.body;
        try { if (first) first.scrollIntoView({ block: 'start', inline: 'nearest' }); } catch (e) { /* old browsers */ }
      }
    };
    toTop();
    window.addEventListener('load', function () { toTop(); [50, 250, 700].forEach(function (ms) { setTimeout(toTop, ms); }); });
  })();

  /* Hover previews on work tiles: load the micro-trailer only when someone points at it */
  if (canHover && !reduceMotion) {
    $$('.tile-media[data-video]').forEach(function (box) {
      var v = null;
      box.parentElement.addEventListener('pointerenter', function () {
        if (!v) {
          v = document.createElement('video');
          v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
          v.setAttribute('aria-hidden', 'true');
          var base = box.getAttribute('data-video');
          ['webm', 'mp4'].forEach(function (ext) {
            var src = document.createElement('source');
            src.src = base + '.' + ext; src.type = 'video/' + ext;
            v.appendChild(src);
          });
          box.insertBefore(v, box.querySelector('.logo'));
        }
        var p = v.play();
        if (p && p.then) p.then(function () { box.classList.add('playing'); }).catch(function () {});
      });
      box.parentElement.addEventListener('pointerleave', function () {
        if (v) { v.pause(); box.classList.remove('playing'); }
      });
    });
  }

  /* Hero videos on case studies stay still for reduced motion */
  if (reduceMotion) $$('video[autoplay]').forEach(function (v) { v.removeAttribute('autoplay'); v.pause(); });

  /* YouTube: embed in place on the real site, link out when framed (previews block embeds) */
  $$('a.yt[data-yt]').forEach(function (a) {
    if (framed) return;
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + a.getAttribute('data-yt') + '?autoplay=1&rel=0';
      f.title = a.getAttribute('data-title') || 'Video';
      f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
      f.allowFullscreen = true;
      a.replaceChildren(f);
      a.removeAttribute('href');
    });
  });

  /* Lightbox for galleries */
  var shots = $$('.gallery [data-full]');
  if (shots.length) {
    var dlg = document.createElement('dialog');
    dlg.className = 'lightbox';
    dlg.innerHTML = '<div class="lb-inner"><img alt=""><div class="lb-bar">' +
      '<button class="btn" type="button" data-lb="prev">Previous</button>' +
      '<span class="num" data-lb="pos"></span>' +
      '<button class="btn" type="button" data-lb="next">Next</button>' +
      '<button class="btn" type="button" data-lb="close">Close</button></div></div>';
    document.body.appendChild(dlg);
    var img = $('img', dlg), pos = $('[data-lb="pos"]', dlg), cur = 0;
    var show = function (i) {
      cur = (i + shots.length) % shots.length;
      img.src = shots[cur].getAttribute('data-full');
      img.alt = shots[cur].querySelector('img').alt;
      pos.textContent = (cur + 1) + ' / ' + shots.length;
    };
    shots.forEach(function (b, i) { b.addEventListener('click', function () { show(i); dlg.showModal(); }); });
    $('[data-lb="prev"]', dlg).addEventListener('click', function () { show(cur - 1); });
    $('[data-lb="next"]', dlg).addEventListener('click', function () { show(cur + 1); });
    $('[data-lb="close"]', dlg).addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.classList.contains('lb-inner')) dlg.close(); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') show(cur - 1);
      if (e.key === 'ArrowRight') show(cur + 1);
    });
  }

  /* Copy email */
  $$('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var text = b.getAttribute('data-copy');
      var done = function () { var t = b.textContent; b.textContent = 'Copied'; setTimeout(function () { b.textContent = t; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { selectAddr(); });
      } else selectAddr();
      function selectAddr() {
        var el = $('.email .addr');
        if (!el) return;
        var r = document.createRange(); r.selectNodeContents(el);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      }
    });
  });

  /* Countdown to a ship date */
  $$('[data-ship]').forEach(function (el) {
    var p = el.getAttribute('data-ship').split('-');
    var ship = new Date(+p[0], +p[1] - 1, +p[2]);
    var now = new Date(); now.setHours(0, 0, 0, 0);
    var days = Math.round((ship - now) / 86400000);
    if (days > 1) el.textContent = days + ' days until launch';
    else if (days === 1) el.textContent = 'Launches tomorrow';
    else if (days === 0) el.textContent = 'Launches today';
  });

})();
