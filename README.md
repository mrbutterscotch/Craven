# Butterscotch Studios Website

Simple static website for `butterscotchstudios.org`, the home of Butterscotch
Studios and Craven.

## Files

- `index.html` - landing page
- `support.html` - support page
- `privacy.html` - privacy policy
- `styles.css` - shared styling
- `assets/hero-craven.jpg` - previous landing page image
- `assets/hero-craven-board.png` - current landing page gameplay banner

## Local Preview

Open `index.html` directly in a browser, or serve the folder:

```sh
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Basic Linode Deployment

Linode SSH target:

```sh
ssh root@172.105.155.225
```

Copy the files to the web root on the server:

```sh
rsync -av --delete \
  --exclude ".git" \
  ./ root@172.105.155.225:/var/www/butterscotchstudios.org/
```

Point these DNS records at the Linode:

```text
butterscotchstudios.org      A      172.105.155.225
www.butterscotchstudios.org  A      172.105.155.225
```

For Nginx, serve `/var/www/butterscotchstudios.org` as a static site and enable
TLS with Certbot for `butterscotchstudios.org` and
`www.butterscotchstudios.org`.

Example Nginx server block:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name butterscotchstudios.org www.butterscotchstudios.org;

    root /var/www/butterscotchstudios.org;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

After DNS resolves to the Linode, enable HTTPS:

```sh
certbot --nginx -d butterscotchstudios.org -d www.butterscotchstudios.org
```
