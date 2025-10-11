# Test Structure

This directory contains the test files for the mandate program, organized by functionality for better maintainability and parallel execution.

## Test Files

### `test-factory.ts`
A shared factory class that provides common test setup functionality:
- Creates test contexts with keypairs, mints, and token accounts
- Provides methods for creating, approving, and managing mandates
- Handles airdrops and account setup
- Singleton pattern ensures consistent setup across all tests

### `create-mandate.test.ts`
Tests for mandate creation functionality:
- Fixed debit type mandates
- Variable debit type mandates
- Unlimited spend mandates
- Duplicate mandate ID prevention

### `approve-mandate.test.ts`
Tests for mandate approval functionality:
- Successful mandate approval
- Prevention of double approval
- Authorization checks (wrong user rejection)

### `execute-mandate.test.ts`
Tests for mandate execution functionality:
- Fixed amount execution
- Variable amount execution
- Limit enforcement
- Authority validation
- Variable debit with different amounts
- Zero amount validation for variable debits

### `modify-cancel-mandate.test.ts`
Tests for mandate modification and cancellation:
- Parameter modification by authority
- Authorization checks for modification
- User-initiated cancellation
- Authority-initiated cancellation
- Unauthorized cancellation prevention

## Running Tests

### Run All Tests
```bash
npm run test:all
```

### Run Individual Test Files
```bash
# Create mandate tests
npm run test:create

# Approve mandate tests
npm run test:approve

# Execute mandate tests
npm run test:execute

# Modify and cancel mandate tests
npm run test:modify-cancel
```

### Run Original Combined Test
```bash
npm run test
```

## Benefits of This Structure

1. **Parallel Execution**: Each test file can run independently, allowing for faster test execution
2. **Better Organization**: Tests are grouped by functionality, making them easier to find and maintain
3. **Shared Setup**: The test factory eliminates code duplication and ensures consistent test setup
4. **Focused Testing**: Each file focuses on a specific aspect of the mandate system
5. **Easier Debugging**: When a specific functionality fails, you can run just that test file

## Dependencies

All tests depend on the `test-factory.ts` for setup, but the individual test files are independent of each other. This means:
- Tests can run in parallel
- Each test file has its own isolated setup
- The factory ensures consistent behavior across all tests


