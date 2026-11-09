/* Prevent repeated taps from creating duplicate financial or HR records. */
(() => {
  const actions = {
    saveKhataCustomer: 'khataCustomerMessage', saveKhataEntry: 'khataEntryMessage',
    saveHREmployee: 'hrEmployeeMessage', saveHRAttendance: 'hrAttendanceMessage',
    saveHRLeave: 'hrLeaveMessage', saveHREmployeePayment: 'hrPaymentMessage'
  };
  for (const [name, messageId] of Object.entries(actions)) {
    const original = window[name]; let running = false;
    if (typeof original !== 'function') continue;
    window[name] = async function (...args) {
      if (running || access.role !== 'owner') return;
      running = true;
      const buttons = [...document.querySelectorAll('button')].filter(button =>
        button.getAttribute('onclick') === name + '()');
      const disabled = buttons.map(button => button.disabled);
      buttons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
      const message = document.getElementById(messageId);
      if (message) message.textContent = 'Saving…';
      try { return await original.apply(this, args); }
      catch (error) { if (message) message.textContent = 'Save nahi hua: ' + (error.message || 'Dobara try karein.'); }
      finally {
        running = false;
        buttons.forEach((button, index) => { button.disabled = disabled[index]; button.removeAttribute('aria-busy'); });
      }
    };
  }
})();
