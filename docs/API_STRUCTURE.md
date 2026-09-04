# API Structure

## Base URL
```
http://localhost:3000/api
```

## API Endpoints (To be implemented)

### Authentication
- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `POST /auth/logout` - User logout
- `POST /auth/refresh` - Refresh token

### Users
- `GET /users` - List all users
- `GET /users/:id` - Get user by ID
- `POST /users` - Create new user
- `PUT /users/:id` - Update user
- `DELETE /users/:id` - Delete user

### Inventory
- `GET /inventory` - List inventory items
- `GET /inventory/:id` - Get item by ID
- `POST /inventory` - Add new item
- `PUT /inventory/:id` - Update item
- `DELETE /inventory/:id` - Delete item

### Sales
- `GET /sales` - List sales
- `POST /sales` - Create new sale
- `GET /sales/:id` - Get sale details

### Reports
- `GET /reports/inventory` - Inventory report
- `GET /reports/sales` - Sales report

## Error Handling

All endpoints return responses in the following format:

**Success (200, 201):**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error (400, 401, 404, 500):**
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```
