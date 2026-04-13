BEGIN TRANSACTION;

DELETE FROM allocations
WHERE id NOT IN (
    SELECT MAX(id)
    FROM allocations
    GROUP BY theme_id, member_id, month
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_allocation
ON allocations(theme_id, member_id, month);

COMMIT;
