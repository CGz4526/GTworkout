# P2 代表性查询计划

环境：2026-10-16，本机 Docker PostgreSQL 17.6；infra/smoke-test.ps1 产生的 1 条合成训练记录。当前快照已 READY。参数只指向本轮新建合成备份，不扫描或输出真实训练内容。

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.local_date, count(*)
FROM snapshot_session s
WHERE s.backup_id = :synthetic_backup_id AND s.finished
GROUP BY s.local_date
ORDER BY s.local_date;
```

实际计划，备份 UUID 仅替换为占位符，其余为原始结果：

```text
GroupAggregate  (cost=0.14..8.18 rows=1 width=12) (actual time=0.110..0.111 rows=1 loops=1)
  Group Key: local_date
  Buffers: shared hit=2
  ->  Index Scan using ix_session_date on snapshot_session s  (cost=0.14..8.16 rows=1 width=4) (actual time=0.104..0.104 rows=1 loops=1)
        Index Cond: (backup_id = '<synthetic-backup-id>'::uuid)
        Filter: finished
        Buffers: shared hit=2
Planning:
  Buffers: shared hit=174
Planning Time: 1.407 ms
Execution Time: 0.324 ms
```

这验证查询读取按 backup_id/local_date 建索引的投影，不需要取原始 BYTEA 或重新解析 JSON。单行样本没有覆盖大量 sessions/sets 的聚合成本，不能据此证明优化收益；完整负载与前后对照留待 P4。原始输出在忽略的 .cache/p2-query-plan.txt，重新运行时使用新合成资源 ID。
