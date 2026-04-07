# SQL Codelab

SQL Codelab is an interactive SQL learning and practice platform built with React and Vite. It provides a full-featured SQL editor with syntax highlighting, autocomplete, a built-in database engine, and an extensive cookbook of SQL examples.

## Overview

SQL Codelab allows users to write, execute, and learn SQL queries in a browser-based environment. It includes an in-memory database with sample data (employees, departments, products, orders), real-time syntax checking, and result visualization in multiple formats.

## Features

### SQL Editor
- Multi-tab editor for managing multiple queries
- Real-time syntax highlighting with color-coded tokens
- Line numbers with click-to-navigate support
- Smart indentation on Enter with bracket-aware nesting detection
- Autocomplete suggestions for SQL keywords, functions, tables, and columns
- Bracket auto-closing and auto-deletion
- Smart bracket exit (skip closing bracket if already present)
- Tab key for 2-space indentation
- Customizable tab naming and renaming with double-click

### Code Intelligence
- Real-time linting and error detection
- Autocomplete dropdown positioned below the current line
- Smart suggestions that filter based on context
- Support for SQL keywords, built-in functions, table names, and column names

### Database Engine
- In-memory SQLite-like database with full SQL support
- Sample data: employees, departments, products, orders tables
- Support for complex SQL operations: SELECT, INSERT, UPDATE, DELETE, CREATE, DROP
- Advanced features: JOINs (INNER, LEFT, RIGHT, FULL, CROSS), GROUP BY, HAVING, ORDER BY, DISTINCT
- Expression evaluation: arithmetic, string concatenation, comparison, boolean logic
- Aggregate functions: COUNT, SUM, AVG, MIN, MAX
- String functions: UPPER, LOWER, LENGTH, SUBSTR, TRIM, REPLACE, CONCAT
- Date functions: NOW, YEAR, MONTH, DAY
- Special functions: COALESCE, NULLIF, CAST, ISNULL, NVL
- CASE expressions for conditional logic
- Reset database to sample data at any time

### Results Panel
- Table view with sortable columns (click header to sort ascending/descending)
- Row and column count display
- Row number column for easy reference
- Resizable results panel with drag-to-adjust height
- Multi-format visualization: table, bar chart, pie chart
- Color-coded data types (numbers in green, nulls in gray italics)
- Execution messages and error reporting

### Schema Browser
- Collapsible sidebar showing all tables and their columns
- Quick reference for available tables and column names
- Table row count indicator
- Resizable sidebar with drag-to-adjust width
- Toggle to show/hide sidebar
- Database reset button to restore sample data

### SQL Cookbook
- Categorized examples across 8 categories:
  - Basic SELECT: SELECT all/specific columns, aliases, limit/offset, DISTINCT, computed columns
  - Filtering: WHERE, AND/OR, LIKE patterns, IN lists, BETWEEN, NULL checks, NOT IN
  - Aggregations: COUNT, SUM/AVG/MIN/MAX, GROUP BY, HAVING, category statistics
  - JOINs: INNER JOIN, LEFT JOIN, multi-table joins, joins with aggregation
  - String Functions: UPPER/LOWER, LENGTH, SUBSTR, concatenation, REPLACE, TRIM
  - DDL: CREATE TABLE, DROP TABLE, INSERT INTO, multi-row inserts
  - DML: UPDATE rows, DELETE rows, conditional updates with CASE
  - Advanced: CASE expressions, string aggregation patterns, NULL handling, function chaining
- Copy-to-clipboard functionality for all examples
- Formatted SQL with proper indentation
- Hover feedback for easy discovery

### Export
- Export queries as .sql files
- Download current editor content for external use

### User Interface
- Dark theme optimized for long coding sessions
- Responsive layout with flexible panels
- Smooth animations and transitions
- Color-coded syntax highlighting:
  - Keywords: Blue
  - Functions: Yellow
  - Strings: Orange
  - Numbers: Green
  - Comments: Gray
  - Operators: Light gray
  - Identifiers: Light blue
  - Punctuation: Dark gray
- Intuitive navigation with tab switching

## Keyboard Shortcuts

- Ctrl+Enter (Cmd+Enter on macOS): Execute query
- Tab: Insert 2-space indent
- Enter: Auto-indent with bracket awareness
- Backspace/Delete: Smart bracket deletion with matching pair removal
- ArrowUp/ArrowDown: Navigate autocomplete suggestions
- Escape: Close autocomplete dropdown
- Tab/Enter: Accept autocomplete suggestion
- Double-click: Rename editor tab

## Project Structure

```
sql-codelab/
├── src/
│   ├── App.jsx          Main component with full SQL editor implementation
│   ├── App.css          Styles for the application
│   ├── main.jsx         React entry point
│   ├── index.css        Global styles
│   └── assets/          Static assets
├── public/              Public assets
├── index.html           HTML entry point
├── package.json         Project dependencies
├── vite.config.js       Vite configuration
└── eslint.config.js     ESLint configuration
```

## Technology Stack

- React: UI framework
- Vite: Build tool and development server
- Recharts: Chart visualization library
- JavaScript: Core language (ES2020+)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd sql-codelab
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to the URL shown in the terminal (typically http://localhost:5173)

## Building for Production

Build optimized bundle:
```bash
npm run build
```

Preview production build:
```bash
npm run preview
```

## Core Components

### Tokenizer
Converts SQL input into tokens for syntax highlighting and parsing. Handles:
- Keywords and functions
- String literals (single and double quotes)
- Identifiers (backtick-quoted)
- Numbers and decimals
- Comments (line and block)
- Operators and punctuation

### SQL Parser
Full recursive descent parser supporting:
- SELECT statements with complex expressions
- INSERT, UPDATE, DELETE, CREATE, DROP statements
- Expression parsing with operator precedence
- CASE expressions
- Function calls with arguments
- Table references with aliases
- JOIN operations with ON conditions

### Database Engine
In-memory SQL execution engine providing:
- Query execution with result sets
- Multiple result format support (rows, messages)
- Expression evaluation in various contexts
- Aggregate function computation with grouping
- Join operations with different join types
- Data modification operations

### Linter
Real-time SQL validation checking for:
- Unmatched parentheses and brackets
- Unclosed string literals
- Parse errors
- Syntax violations

## Development Notes

- The editor uses a textarea with overlay syntax highlighting for performance
- Smart bracket handling prevents double-closing and enables seamless navigation
- Auto-indentation respects bracket nesting depth
- Suggestions dropdown auto-positions to avoid overflow
- Results table implements virtual scrolling for efficient rendering of large result sets
- All operations are performed in-memory with no backend required

## Browser Compatibility

SQL Codelab works on all modern browsers that support ES2020+ JavaScript:
- Chrome/Chromium 85+
- Firefox 78+
- Safari 14+
- Edge 85+

## Future Enhancements

Potential features for future versions:
- Multi-statement transaction support
- Query history and bookmarks
- Custom table creation and management
- Import/export data in CSV format
- Query performance metrics
- SQL query formatter
- Dark/light theme toggle
- Collaborative editing
- Backend database integration

## License

This project is open source and available for educational purposes.

## Support

For issues, feature requests, or questions, please open an issue in the repository.
