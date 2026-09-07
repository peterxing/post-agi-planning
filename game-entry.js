(() => {
  'use strict';
  const descriptions = {
    balanced:'Capability, institutions and physical capacity advance at different rates.',
    accelerated:'Faster capability growth puts more pressure on control and the transition floor.',
    managed:'More coordination capacity, with slower early output.',
    bottleneck:'Power and deployment capacity are constrained. Resilience and patient sequencing matter.',
  };
  const landing = document.getElementById('gameLanding');
  const status = document.getElementById('gameLoadStatus');
  const profile = document.getElementById('campaignProfile');
  const reduced = document.getElementById('campaignReduced');
  const cancel = document.getElementById('cancelGameLoad');
  const buttons = ['startGame','resumeGame','startAccessible'].map(id => document.getElementById(id));
  let controller = null, generation = 0;
  reduced.checked = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  profile.addEventListener('change', () => {
    document.getElementById('profileDescription').textContent = descriptions[profile.value] || 'Unknown profile. Choose an available option.';
  });
  document.getElementById('landingTheme').addEventListener('click', () => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  });
  function busy(value) {
    buttons.forEach(button => { button.disabled = value; });
    profile.disabled = value;
    document.getElementById('campaignRenderer').disabled = value;
    reduced.disabled = value;
    cancel.hidden = !value;
  }
  async function enter(mode, resume) {
    const current = ++generation;
    controller = new AbortController();
    busy(true); status.classList.remove('error');
    status.textContent = 'Loading the campaign and checking its published source bindings...';
    try {
      const game = await import('./game-ui.mjs');
      if (current !== generation) return;
      const result = await game.startCampaign({
        profile:profile.value, mode, resume, reducedMotion:reduced.checked,
        rendererPreference:document.getElementById('campaignRenderer').value, signal:controller.signal,
        onExit(message) {
          landing.hidden = false;
          document.getElementById('gameStage').hidden = true;
          status.textContent = message || 'Campaign closed. The 3D engine has been stopped.';
          document.getElementById('startGame').focus();
        },
      });
      if (current !== generation) return;
      landing.hidden = result.started;
    } catch (error) {
      if (current !== generation) return;
      status.classList.add('error');
      status.textContent = controller.signal.aborted ? 'Loading cancelled. No campaign was started.' : `Campaign unavailable: ${error.message}`;
    } finally {
      if (current === generation) { busy(false); controller = null; }
    }
  }
  buttons[0].addEventListener('click', () => enter('3d',false));
  buttons[1].addEventListener('click', () => enter('3d',true));
  buttons[2].addEventListener('click', () => enter('accessible',false));
  cancel.addEventListener('click', () => {
    generation++; controller?.abort('cancelled'); controller = null;
    busy(false); status.textContent = 'Loading cancelled. No campaign was started.';
  });
})();
