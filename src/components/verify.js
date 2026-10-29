const { respond, UserError } = require('../core/context');
const A = require('../core/automod');
const ui = require('../core/ui');

module.exports = {
  id: 'verify',
  async run(client, i) {
    try {
      const roleId = A.cfg(i.guild.id).verify.role;
      const role = roleId && i.guild.roles.cache.get(roleId);
      if (!role) throw new UserError('Verification is not set up', 'The verify role no longer exists.', 'Ask an admin to run /automod verify again.');
      if (i.member.roles.cache.has(role.id)) return respond(i, ui.ok('Already verified', 'You are all set.'));
      await i.member.roles.add(role, 'Verified via button').catch(() => { throw new UserError('I could not verify you', 'My role needs to be above the verified role.', 'Tell a server admin.'); });
      return respond(i, ui.ok('You are verified!', `Welcome in. You now have ${role}.`));
    } catch (err) {
      if (err instanceof UserError) return respond(i, ui.err(err.title, err.desc, err.hint));
      console.error('[verify]', err);
      return respond(i, ui.err('Something went wrong', 'That button did not work.', 'Try again in a moment.'));
    }
  },
};
