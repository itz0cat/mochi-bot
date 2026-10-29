const { respond, UserError } = require('../core/context');
const ui = require('../core/ui');

function guard(fn) {
  return async (client, i) => {
    try { await fn(client, i); } catch (err) {
      if (err instanceof UserError) return respond(i, ui.err(err.title, err.desc, err.hint));
      console.error('[role panel]', err);
      return respond(i, ui.err('Something went wrong', 'That did not work.', 'Try again in a moment.'));
    }
  };
}
const check = (guild, role) => {
  if (!role) throw new UserError('Role not found', 'That role no longer exists.');
  if (role.position >= guild.members.me.roles.highest.position || role.managed) throw new UserError('I cannot give that role', 'It is above my highest role.', 'Tell a server admin.');
};

module.exports = [
  {
    id: 'rolebtn',
    run: guard(async (client, i) => {
      const role = i.guild.roles.cache.get(i.customId.split(':')[1]);
      check(i.guild, role);
      if (i.member.roles.cache.has(role.id)) { await i.member.roles.remove(role); return respond(i, ui.ok('Role removed', `You no longer have ${role}.`)); }
      await i.member.roles.add(role);
      return respond(i, ui.ok('Role added', `You now have ${role}.`));
    }),
  },
  {
    id: 'rolemenu',
    run: guard(async (client, i) => {
      const all = i.component.options.map((o) => o.value);
      const picked = new Set(i.values);
      const add = []; const remove = [];
      for (const id of all) {
        const role = i.guild.roles.cache.get(id);
        if (!role) continue;
        check(i.guild, role);
        const has = i.member.roles.cache.has(id);
        if (picked.has(id) && !has) add.push(id);
        if (!picked.has(id) && has) remove.push(id);
      }
      if (add.length) await i.member.roles.add(add);
      if (remove.length) await i.member.roles.remove(remove);
      return respond(i, ui.ok('Roles updated', `Added **${add.length}**, removed **${remove.length}**.`));
    }),
  },
];
