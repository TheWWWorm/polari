import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WikiData } from '../../core/wiki-data';
import { SpoilerSelect } from '../../layout/spoiler-select';
@Component({
  selector: 'app-home-page',
  imports: [RouterLink, SpoilerSelect],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomePage {
  protected readonly data = inject(WikiData);
}
