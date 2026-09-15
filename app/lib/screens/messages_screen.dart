import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/portal_models.dart';
import '../providers/portal_provider.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/focusable_card.dart';
import '../widgets/portal_widgets.dart';

/// Bandeja de mensajes del portal.
class MessagesScreen extends StatelessWidget {
  final bool standalone;
  const MessagesScreen({super.key, this.standalone = false});

  Future<void> _open(BuildContext context, PortalMessage m) async {
    final portal = context.read<PortalProvider>();
    await portal.markRead(m);
    if (context.mounted) await showMessageDialog(context, m);
  }

  @override
  Widget build(BuildContext context) {
    final portal = context.watch<PortalProvider>();
    final messages = portal.messages;
    final Widget content;
    if (!portal.enabled) {
      content = const EmptyView(
        icon: Icons.mail_outline_rounded,
        message: 'Los mensajes no están disponibles para este servidor.',
      );
    } else {
      content = RefreshIndicator(
        onRefresh: portal.refresh,
        child: messages.isEmpty
            ? ListView(children: const [
                SizedBox(height: 120),
                EmptyView(
                  icon: Icons.mark_email_read_outlined,
                  message: 'No tiene mensajes.',
                ),
              ])
            : ListView.builder(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(12),
                itemCount: messages.length,
                itemBuilder: (context, i) {
                  final m = messages[i];
                  final color = messageKindColor(m.kind);
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: FocusableCard(
                      autofocus: i == 0,
                      focusScale: 1.02,
                      onTap: () => _open(context, m),
                      padding: const EdgeInsets.all(14),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          CircleAvatar(
                            radius: 20,
                            backgroundColor: color.withValues(alpha: 0.18),
                            child: Icon(messageKindIcon(m.kind),
                                color: color, size: 22),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        m.title.isEmpty ? m.kind.label : m.title,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          fontSize: 15,
                                          fontWeight: m.read
                                              ? FontWeight.w500
                                              : FontWeight.w800,
                                        ),
                                      ),
                                    ),
                                    if (!m.read)
                                      Container(
                                        width: 10,
                                        height: 10,
                                        decoration: const BoxDecoration(
                                          color: AppColors.accent,
                                          shape: BoxShape.circle,
                                        ),
                                      ),
                                  ],
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  '${m.kind.label}${m.createdAt != null ? ' · ${formatDateTime(m.createdAt!)}' : ''}',
                                  style: TextStyle(fontSize: 12, color: color),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  m.body,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      fontSize: 13,
                                      color: AppColors.textSecondary),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
      );
    }
    if (!standalone) return content;
    return Scaffold(
      appBar: AppBar(title: const Text('Mensajes')),
      body: SafeArea(top: false, child: content),
    );
  }
}
